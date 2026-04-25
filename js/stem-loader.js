// stem-loader.js — lazy loading with priority queue and 3-room eviction window

export function createStemLoader(engine, config) {
  const rooms = config.rooms;

  function getStemsForRoom(idx) {
    if (idx < 0 || idx >= rooms.length) return [];
    const drones = rooms[idx].drones || [];
    const stingerIds = (rooms[idx].stingers || []).map(s => s.id);
    const roomIntroId = rooms[idx].roomIntro ? [rooms[idx].roomIntro.id] : [];
    return [...rooms[idx].stems, ...drones, ...stingerIds, ...roomIntroId];
  }

  async function prepareForRoom(idx, onProgress) {
    const current = getStemsForRoom(idx);
    const next = idx < rooms.length - 1 ? getStemsForRoom(idx + 1) : [];
    const prev = idx > 0 ? getStemsForRoom(idx - 1) : [];

    // Deduplicate — current first (highest priority)
    const all = [...new Set([...current, ...next, ...prev])];
    const stillNeeded = new Set(all);

    // Load current room stems first, then the rest fire-and-forget
    await engine.loadStems(current, onProgress);
    const remaining = all.filter(s => !current.includes(s));
    if (remaining.length > 0) engine.loadStems(remaining, onProgress);

    // Evict stems from rooms outside the current 3-room window that aren't still needed
    if (idx >= 3) {
      for (let i = 0; i <= idx - 3; i++) {
        const candidates = getStemsForRoom(i).filter(s => !stillNeeded.has(s));
        if (candidates.length > 0) engine.unloadStems(candidates);
      }
    }
  }

  return { prepareForRoom };
}
