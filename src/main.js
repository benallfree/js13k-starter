// Entry point: reads the level data, sets up the canvas and input, and runs the game loop.
// tools/build.mjs starts here and pulls in the modules this file imports.
import { makeWorld, updateWorld, drawWorld } from './world.js'

// The level is pretty JSON in src/level.json, inlined into the page at build time. Keep this exact read form:
// tools/roadroll.mjs finds it to inline the data into the packed code.
const level = JSON.parse(document.getElementById('level').textContent)

const canvas = document.getElementById('game')
const context = canvas.getContext('2d')
const hud = document.getElementById('hud')
document.getElementById('build').textContent = 'build BUILD_ID'
document.title = level.title

let world
function resize() {
  canvas.width = innerWidth
  canvas.height = innerHeight
  world = makeWorld(level, canvas.width, canvas.height)
}
addEventListener('resize', resize)
resize()

// Keyboard: arrows or WASD. Touch or mouse: fly toward the pointer while it's down.
const keys = new Set()
addEventListener('keydown', (event) => {
  keys.add(event.key.toLowerCase())
  if (world.state != 'playing' && event.key == 'Enter') resize()
})
addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()))
let pointer = null
canvas.addEventListener('pointerdown', (event) => {
  pointer = event
  if (world.state != 'playing') resize()
})
canvas.addEventListener('pointermove', (event) => pointer && (pointer = event))
addEventListener('pointerup', () => (pointer = null))

function readInput() {
  const input = { x: 0, y: 0 }
  if (keys.has('arrowleft') || keys.has('a')) input.x -= 1
  if (keys.has('arrowright') || keys.has('d')) input.x += 1
  if (keys.has('arrowup') || keys.has('w')) input.y -= 1
  if (keys.has('arrowdown') || keys.has('s')) input.y += 1
  if (pointer && Math.hypot(pointer.clientX - world.ship.x, pointer.clientY - world.ship.y) > 4) {
    input.x = pointer.clientX - world.ship.x
    input.y = pointer.clientY - world.ship.y
  }
  return input
}

// A short rising beep from the Web Audio API; the audio context starts on the first sound, after a user gesture.
let audio
function beep(pitch) {
  audio ??= new AudioContext()
  const oscillator = audio.createOscillator()
  const gain = audio.createGain()
  oscillator.frequency.setValueAtTime(pitch, audio.currentTime)
  oscillator.frequency.exponentialRampToValueAtTime(pitch * 2, audio.currentTime + 0.1)
  gain.gain.setValueAtTime(0.2, audio.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.2)
  oscillator.connect(gain).connect(audio.destination)
  oscillator.start()
  oscillator.stop(audio.currentTime + 0.2)
}

let last = performance.now()
function frame(now) {
  const seconds = Math.min(0.05, (now - last) / 1000)
  last = now
  for (const star of updateWorld(world, readInput(), seconds)) beep(440 + star.points * 110)
  drawWorld(world, context, now / 1000)

  const status = {
    playing: `Stars ${world.score} · ${Math.ceil(world.timeLeft)}s`,
    won: `All stars caught with ${Math.ceil(world.timeLeft)}s to spare! Tap or press Enter to play again.`,
    lost: `Out of time with ${world.score} points. Tap or press Enter to try again.`,
  }
  hud.textContent = world.state == 'playing' && world.timeLeft > level.secondsToWin - 4 ? level.hint : status[world.state]
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
