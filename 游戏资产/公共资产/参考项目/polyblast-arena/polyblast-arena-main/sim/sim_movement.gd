## Quake-3-baseline movement math. Static, stateless — the SIM's only movement
## resolver. Units are meters (1 Quake unit = 0.0254 m):
##   320 u/s ground cap = 8.13 m/s, 270 u/s jump = 6.86 m/s, g = 800 u/s² = 20.32 m/s².

const MAX_GROUND_SPEED := 8.13
const CROUCH_MULT := 0.5
const ACCEL := 10.0          # ground acceleration (Q3 pm_accelerate)
const AIR_ACCEL := 1.0       # Q3 pm_airaccelerate — air-strafe gain comes free
const FRICTION := 6.0
const STOP_SPEED := 2.54
const GRAVITY := 20.32
const JUMP_VEL := 6.86


static func wish_dir(yaw: float, move: Vector2) -> Vector3:
	var local := Vector3(move.x, 0.0, -move.y)
	if local.length_squared() > 1.0:
		local = local.normalized()
	return Basis(Vector3.UP, yaw) * local


static func apply_friction(vel: Vector3, dt: float) -> Vector3:
	var speed := Vector3(vel.x, 0, vel.z).length()
	if speed < 0.01:
		return Vector3(0, vel.y, 0)
	var control := maxf(speed, STOP_SPEED)
	var drop := control * FRICTION * dt
	var scale := maxf(speed - drop, 0.0) / speed
	return Vector3(vel.x * scale, vel.y, vel.z * scale)


## Classic PM_Accelerate: only adds speed along wishdir up to wishspeed,
## which is what makes air-strafing and bunny-hop work.
static func accelerate(vel: Vector3, wishdir: Vector3, wishspeed: float, accel: float, dt: float) -> Vector3:
	var current := vel.dot(wishdir)
	var add := wishspeed - current
	if add <= 0.0:
		return vel
	var accel_speed := minf(accel * wishspeed * dt, add)
	return vel + wishdir * accel_speed


static func ground_move(vel: Vector3, wishdir: Vector3, crouching: bool, dt: float) -> Vector3:
	var wishspeed := MAX_GROUND_SPEED * (CROUCH_MULT if crouching else 1.0)
	return accelerate(vel, wishdir, wishspeed, ACCEL, dt)


static func air_move(vel: Vector3, wishdir: Vector3, dt: float) -> Vector3:
	var out := accelerate(vel, wishdir, MAX_GROUND_SPEED, AIR_ACCEL, dt)
	out.y -= GRAVITY * dt
	return out
