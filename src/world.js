// The game state and its rules: a ship that flies toward the input direction and stars it collects.
// Positions are in pixels; star positions in the level file are fractions of the screen, so any window size works.

export function makeWorld(level, width, height) {
  return {
    level,
    width,
    height,
    ship: { x: width / 2, y: height / 2 },
    stars: level.stars.map((star) => ({ x: star.x * width, y: star.y * height, points: star.points, caught: false })),
    score: 0,
    timeLeft: level.secondsToWin,
    state: 'playing', // 'playing', 'won' or 'lost'
  }
}

// Moves the ship by the input direction (each axis -1..1), catches stars it touches and runs the clock.
// Returns the stars caught this step, so the caller can play a sound for each.
export function updateWorld(world, input, seconds) {
  if (world.state != 'playing') return []
  const { ship, level } = world
  const length = Math.hypot(input.x, input.y) || 1
  ship.x = Math.min(world.width, Math.max(0, ship.x + (input.x / length) * level.ship.speed * seconds))
  ship.y = Math.min(world.height, Math.max(0, ship.y + (input.y / length) * level.ship.speed * seconds))

  const caught = []
  for (const star of world.stars) {
    if (star.caught || Math.hypot(star.x - ship.x, star.y - ship.y) > level.ship.radius + 12) continue
    star.caught = true
    world.score += star.points
    caught.push(star)
  }

  world.timeLeft = Math.max(0, world.timeLeft - seconds)
  if (world.stars.every((star) => star.caught)) world.state = 'won'
  else if (world.timeLeft == 0) world.state = 'lost'
  return caught
}

export function drawWorld(world, context, time) {
  const { colors, ship } = world.level
  context.fillStyle = colors.sky
  context.fillRect(0, 0, world.width, world.height)

  context.fillStyle = colors.star
  for (const star of world.stars) {
    if (star.caught) continue
    const size = 6 + star.points * 3 + Math.sin(time * 4 + star.x) * 2
    drawStar(context, star.x, star.y, size)
  }

  context.fillStyle = colors.ship
  context.beginPath()
  context.arc(world.ship.x, world.ship.y, ship.radius, 0, Math.PI * 2)
  context.fill()
}

function drawStar(context, x, y, size) {
  context.beginPath()
  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI) / 5 - Math.PI / 2
    const radius = i % 2 ? size / 2 : size
    context.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)
  }
  context.fill()
}
