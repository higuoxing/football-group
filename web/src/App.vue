<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { usePlayerStore } from './stores/players'
import { useTeamStore } from './stores/teams'
import PlayerSearch from './components/PlayerSearch.vue'
import PlayerRoster from './components/PlayerRoster.vue'
import TeamResult from './components/TeamResult.vue'
import MatchReports from './components/MatchReports.vue'
import AddPlayerModal from './components/modals/AddPlayerModal.vue'
import EditPlayerModal from './components/modals/EditPlayerModal.vue'

const playerStore = usePlayerStore()
const teamStore = useTeamStore()

const addPlayerOpen = ref(false)
const editPlayerId = ref<number | null>(null)

onMounted(async () => {
  await playerStore.load()
  teamStore.load(new Set(playerStore.players.map((p) => p.id)))
})
</script>

<template>
  <div class="container">
    <header>
      <h1>⚽ 足球比赛分组系统</h1>
      <p>公平竞赛，快乐足球</p>
    </header>

    <PlayerSearch @edit="editPlayerId = $event" />

    <PlayerRoster
      @open-add="addPlayerOpen = true"
      @open-edit="editPlayerId = $event"
    />

    <TeamResult />

    <MatchReports />
  </div>

  <Teleport to="body">
    <AddPlayerModal v-if="addPlayerOpen" @close="addPlayerOpen = false" />
    <EditPlayerModal
      v-if="editPlayerId !== null"
      :player-id="editPlayerId"
      @close="editPlayerId = null"
    />
  </Teleport>
</template>
