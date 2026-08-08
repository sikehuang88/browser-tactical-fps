import * as THREE from 'three'
import type { EntitySnapshot } from '../core/types'
import {
  createCharacterInstance,
  disposeCharacterInstance,
  loadOperatorAsset,
  setCharacterMotion,
  type CharacterAsset,
  type CharacterInstance,
  type OperatorId,
} from './characterAssets'
import { createGameplayModel, disposeGameplayModel, gameplayModelForWeapon, gameplayModelRotationY, type GameplayModelId } from './gameplayAssets'

interface PlayerRender {
  group: THREE.Group
  indicator: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  fallback: THREE.Group | null
  character: CharacterInstance | null
  operatorId: OperatorId
  team: number
  weapon: THREE.Group | null
  weaponId: number
}

/** Render remote players with rigged GLB characters and state-driven animation. */
export class EntityView {
  private readonly players = new Map<number, PlayerRender>()
  private readonly assets = new Map<OperatorId, CharacterAsset>()
  private readonly weaponAssets = new Map<GameplayModelId, THREE.Group>()

  constructor(private readonly scene: THREE.Scene) {
    for (const id of ['vanguard', 'sentinel'] as const) {
      void loadOperatorAsset(id)
        .then((asset) => this.assets.set(id, asset))
        .catch((error) => console.warn(`[character] Failed to load ${id}`, error))
    }
    for (const id of ['rifle', 'sniper', 'pistol', 'pinkM4', 'laserCannon'] as const) {
      void createGameplayModel(id)
        .then((model) => this.weaponAssets.set(id, model))
        .catch((error) => console.warn(`[weapon] Failed to load ${id}`, error))
    }
  }

  update(entities: EntitySnapshot[], localId: number, deltaSeconds = 1 / 60): void {
    const seen = new Set<number>()

    for (const entity of entities) {
      if (entity.id === localId || entity.health <= 0) continue
      seen.add(entity.id)

      const operatorId = operatorForTeam(entity.team)
      let player = this.players.get(entity.id)
      if (!player) {
        player = this.createPlayer(operatorId, entity.team)
        this.players.set(entity.id, player)
        this.scene.add(player.group)
      }

      this.ensureCharacter(player, operatorId)
      if (player.team !== entity.team) this.setTeam(player, entity.team)
      this.ensureWeapon(player, entity.weaponId)
      if (entity.isBot) {
        const engaged = (entity.targetId ?? 0) > 0
        player.indicator.material.opacity = entity.health > 0 ? (engaged ? 0.95 : 0.58) : 0
        player.indicator.material.color.copy(engaged ? new THREE.Color(0xffa23a) : teamColor(entity.team))
      }

      player.group.scale.set(1, entity.crouching ? 0.76 : 1, 1)
      player.group.position.set(entity.position.x, entity.position.y, entity.position.z)
      player.group.rotation.y = THREE.MathUtils.degToRad(entity.yaw)

      if (player.character) {
        setCharacterMotion(
          player.character,
          entity.sprinting ? 'run' : entity.moving ? 'walk' : 'idle',
        )
        player.character.mixer.update(Math.min(deltaSeconds, 0.1))
      }
    }

    for (const [id, player] of this.players) {
      if (seen.has(id)) continue
      this.disposePlayer(player)
      this.scene.remove(player.group)
      this.players.delete(id)
    }
  }

  clear(): void {
    for (const player of this.players.values()) {
      this.disposePlayer(player)
      this.scene.remove(player.group)
    }
    this.players.clear()
  }

  private createPlayer(operatorId: OperatorId, team: number): PlayerRender {
    const group = new THREE.Group()
    const indicator = createTeamIndicator(team)
    group.add(indicator)

    const player: PlayerRender = {
      group,
      indicator,
      fallback: null,
      character: null,
      operatorId,
      team,
      weapon: null,
      weaponId: 0,
    }
    this.ensureCharacter(player, operatorId)
    return player
  }

  private ensureCharacter(player: PlayerRender, operatorId: OperatorId): void {
    if (player.operatorId !== operatorId) {
      this.removeVisual(player)
      player.operatorId = operatorId
    }

    const asset = this.assets.get(operatorId)
    if (asset && !player.character) {
      if (player.fallback) {
        player.group.remove(player.fallback)
        disposeFallback(player.fallback)
        player.fallback = null
      }
      player.character = createCharacterInstance(asset)
      player.character.root.rotation.y = Math.PI
      player.group.add(player.character.root)
      return
    }

    if (!asset && !player.fallback) {
      player.fallback = createFallback(player.team)
      player.group.add(player.fallback)
    }
  }

  private ensureWeapon(player: PlayerRender, weaponId: number): void {
    if (player.weaponId === weaponId && player.weapon) return
    if (player.weapon) {
      player.group.remove(player.weapon)
      disposeGameplayModel(player.weapon)
      player.weapon = null
    }
    player.weaponId = weaponId
    const modelId = gameplayModelForWeapon(weaponId)
    if (modelId === 'knife' || modelId === 'grenade') return
    const source = this.weaponAssets.get(modelId)
    if (!source) return
    const weapon = source.clone(true)
    weapon.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.material = Array.isArray(object.material)
        ? object.material.map((material) => material.clone())
        : object.material.clone()
    })
    weapon.scale.setScalar(modelId === 'sniper' ? 0.42 : 0.36)
    weapon.position.set(0.34, 1.08, -0.06)
    weapon.rotation.set(0.18, gameplayModelRotationY(modelId), 0.1)
    weapon.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true
        object.receiveShadow = true
      }
    })
    player.group.add(weapon)
    player.weapon = weapon
  }

  private setTeam(player: PlayerRender, team: number): void {
    player.team = team
    player.indicator.material.color.copy(teamColor(team))
    if (player.fallback) recolorFallback(player.fallback, team)
  }

  private removeVisual(player: PlayerRender): void {
    if (player.character) {
      player.group.remove(player.character.root)
      disposeCharacterInstance(player.character)
      player.character = null
    }
    if (player.fallback) {
      player.group.remove(player.fallback)
      disposeFallback(player.fallback)
      player.fallback = null
    }
    if (player.weapon) {
      player.group.remove(player.weapon)
      disposeGameplayModel(player.weapon)
      player.weapon = null
    }
  }

  private disposePlayer(player: PlayerRender): void {
    this.removeVisual(player)
    player.indicator.geometry.dispose()
    player.indicator.material.dispose()
  }
}

const TEAM_COLORS = [0x89939c, 0xd76c45, 0x4eb7cf]

function operatorForTeam(team: number): OperatorId {
  return team === 2 ? 'sentinel' : 'vanguard'
}

function teamColor(team: number): THREE.Color {
  return new THREE.Color(TEAM_COLORS[team] ?? TEAM_COLORS[0])
}

function createTeamIndicator(team: number): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> {
  const indicator = new THREE.Mesh(
    new THREE.RingGeometry(0.43, 0.5, 32),
    new THREE.MeshBasicMaterial({ color: teamColor(team), transparent: true, opacity: 0.72, side: THREE.DoubleSide }),
  )
  indicator.rotation.x = -Math.PI / 2
  indicator.position.y = 0.025
  return indicator
}

function createFallback(team: number): THREE.Group {
  const group = new THREE.Group()
  const color = teamColor(team)
  const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.8 })
  const headMaterial = new THREE.MeshStandardMaterial({ color: color.clone().offsetHSL(0, 0, 0.12), roughness: 0.8 })
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.2, 0.38), bodyMaterial)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), headMaterial)
  body.position.y = 0.6
  head.position.y = 1.52
  group.add(body, head)
  return group
}

function recolorFallback(group: THREE.Group, team: number): void {
  const color = teamColor(team)
  group.traverse((object) => {
    if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) {
      object.material.color.copy(color)
    }
  })
}

function disposeFallback(group: THREE.Group): void {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry.dispose()
    const material = object.material
    if (Array.isArray(material)) material.forEach((item) => item.dispose())
    else material.dispose()
  })
}
