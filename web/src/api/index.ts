import type { Player, PlayerPosition, PositionInput, Game, GameDetail, CreateGamePayload, Report } from '../types'
import { load, save, nextId, isFirstRun } from '../lib/storage'

// ─────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────

function getPlayers(): Player[] {
  return load<Player[]>('players', [])
}
function setPlayers(p: Player[]): void {
  save('players', p)
}

function getGames(): GameDetail[] {
  return load<GameDetail[]>('games', [])
}
function setGames(g: GameDetail[]): void {
  save('games', g)
}

function buildPositions(inputs: PositionInput[], playerId: number): PlayerPosition[] {
  return inputs.map((p, i) => ({
    id: nextId('player_pos'),
    player_id: playerId,
    position: p.position,
    pac: p.pac ?? 50,
    sho: p.sho ?? 50,
    pas: p.pas ?? 50,
    dri: p.dri ?? 50,
    def: p.def ?? 50,
    phy: p.phy ?? 50,
    sort_order: i,
  }))
}

// ─────────────────────────────────────────────────
// Seeding from players.csv on first run
// ─────────────────────────────────────────────────

async function seedPlayers(): Promise<void> {
  try {
      const res = await fetch(import.meta.env.BASE_URL + 'players.csv')
    if (!res.ok) return
    const text = await res.text()
    const lines = text.split('\n')

    const players: Player[] = []
    const nameIndex = new Map<string, number>()

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      const f = line.split(',')
      if (f.length < 8) continue

      const name     = f[0].trim()
      const position = f[1].trim() as PositionInput['position']
      const pac = parseInt(f[2]) || 50
      const sho = parseInt(f[3]) || 50
      const pas = parseInt(f[4]) || 50
      const dri = parseInt(f[5]) || 50
      const def = parseInt(f[6]) || 50
      const phy = parseInt(f[7]) || 50

      if (nameIndex.has(name)) {
        const idx = nameIndex.get(name)!
        players[idx].positions.push({
          id: nextId('player_pos'),
          player_id: players[idx].id,
          position,
          pac, sho, pas, dri, def, phy,
          sort_order: players[idx].positions.length,
        })
      } else {
        const id = nextId('player')
        const player: Player = {
          id,
          name,
          avatar: null,
          positions: [{
            id: nextId('player_pos'),
            player_id: id,
            position,
            pac, sho, pas, dri, def, phy,
            sort_order: 0,
          }],
        }
        nameIndex.set(name, players.length)
        players.push(player)
      }
    }

    if (players.length > 0) setPlayers(players)
  } catch {
    // silently ignore; the app still works without seed data
  }
}

// ─────────────────────────────────────────────────
// Players API
// ─────────────────────────────────────────────────

export const playersApi = {
  list: async (): Promise<Player[]> => {
    if (isFirstRun('players_seeded')) {
      await seedPlayers()
    }
    return getPlayers()
  },

  create: async (
    name: string,
    positions: PositionInput[],
    avatar: string | null = null,
  ): Promise<Player> => {
    const players = getPlayers()
    const id = nextId('player')
    const player: Player = {
      id,
      name,
      avatar,
      positions: buildPositions(positions, id),
    }
    players.push(player)
    setPlayers(players)
    return player
  },

  update: async (
    id: number,
    name: string,
    positions: PositionInput[],
    avatar?: string | null,
  ): Promise<Player> => {
    const players = getPlayers()
    const idx = players.findIndex((p) => p.id === id)
    if (idx === -1) throw new Error(`Player ${id} not found`)

    const updated: Player = {
      ...players[idx],
      name,
      avatar: avatar !== undefined ? avatar : players[idx].avatar,
      positions: buildPositions(positions, id),
    }
    players[idx] = updated
    setPlayers(players)
    return updated
  },

  delete: async (id: number): Promise<null> => {
    setPlayers(getPlayers().filter((p) => p.id !== id))
    // Nullify player_id in any game records (mirror ON DELETE SET NULL)
    setGames(
      getGames().map((g) => ({
        ...g,
        players: g.players.map((gp) =>
          gp.player_id === id ? { ...gp, player_id: null } : gp,
        ),
      })),
    )
    return null
  },
}

// ─────────────────────────────────────────────────
// Games API
// ─────────────────────────────────────────────────

export const gamesApi = {
  list: async (): Promise<Game[]> =>
    getGames().map(({ players: _p, ...g }) => g),

  get: async (id: number): Promise<GameDetail> => {
    const game = getGames().find((g) => g.id === id)
    if (!game) throw new Error(`Game ${id} not found`)
    return game
  },

  create: async (payload: CreateGamePayload): Promise<GameDetail> => {
    const games = getGames()
    const id = nextId('game')
    const game: GameDetail = {
      id,
      game_date: payload.game_date,
      team_a_score: payload.team_a_score,
      team_b_score: payload.team_b_score,
      notes: payload.notes,
      created_at: new Date().toISOString(),
      players: payload.players.map((p) => ({
        id: nextId('game_player'),
        game_id: id,
        player_id: p.player_id,
        player_name: p.player_name,
        team: p.team,
        score: p.score,
      })),
    }
    games.unshift(game)
    setGames(games)
    return game
  },

  update: async (
    id: number,
    data: { team_a_score?: number; team_b_score?: number; notes?: string },
  ): Promise<Game> => {
    const games = getGames()
    const idx = games.findIndex((g) => g.id === id)
    if (idx === -1) throw new Error(`Game ${id} not found`)
    games[idx] = { ...games[idx], ...data }
    setGames(games)
    const { players: _p, ...game } = games[idx]
    return game
  },
}

// ─────────────────────────────────────────────────
// Reports API — reads /reports.csv (static file in public/)
// ─────────────────────────────────────────────────

/** Minimal CSV splitter that respects double-quoted fields. */
function splitCsvRow(line: string): string[] {
  const fields: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuote = !inQuote
    } else if (ch === ',' && !inQuote) {
      fields.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  fields.push(cur)
  return fields
}

export const reportsApi = {
  list: async (): Promise<Report[]> => {
    try {
      const res = await fetch(import.meta.env.BASE_URL + 'reports.csv')
      if (!res.ok) return []
      const text = await res.text()
      const reports: Report[] = []

      for (const line of text.split('\n').slice(1)) {
        if (!line.trim()) continue
        const f = splitCsvRow(line)
        if (f.length < 3) continue

        const datetime  = f[0].trim()
        const wordCount = parseInt(f[1].trim()) || 0
        const content   = f[2].trim()
        if (!content) continue

        const date = datetime.split(/[ T]/)[0] || datetime
        reports.push({ date, word_count: wordCount, content })
      }

      return reports.sort((a, b) => b.date.localeCompare(a.date))
    } catch {
      return []
    }
  },
}
