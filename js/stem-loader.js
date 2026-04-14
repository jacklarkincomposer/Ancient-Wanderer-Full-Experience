// stem-loader.js — lazy loading with priority queue and 3-room eviction window

export function createStemLoader(engine, config) {
  const rooms = config.rooms;

  function getStemsForRoom(idx) {
    if (idx < 0 || idx >= rooms.length) return [];
    return rooms[idx].stems;
  }

  function getUniqueStemsForRoom(idx) {
    // Returns stems used ONLY in this room and not in adjacent rooms
    const roomStems = new Set(getStemsForRoom(idx));
    const adjacent = new Set();
    if (idx > 0) getStemsForRoom(idx - 1).forEach(s => adjacent.add(s));
    if (idx < rooms.length - 1) getStemsForRoom(idx + 1).forEach(s => adjacent.add(s));
    return [...roomStems].filter(s => !adjacent.has(s));
  }

  async function prepareForRoom(idx, onProgress) {
    const current = getStemsForRoom(idx);
    const next = idx < rooms.length - 1 ? getStemsForRoom(idx + 1) : [];
    const prev = idx > 0 ? getStemsForRoom(idx - 1) : [];

    // Also load stems needed by credits transition (if this room or next is the outro)
    const outroRoom = rooms.find(r => r.isOutro);
    let creditsStems = [];
    if (outroRoom && outroRoom.creditsTransition) {
      const outroIdx = rooms.indexOf(outroRoom);
      if (idx >= outroIdx - 1) {
        creditsStems = outroRoom.creditsTransition.stemsOn || [];
      }
    }

    // Deduplicate — current first (highest priority)
    const all = [...new Set([...current, ...creditsStems, ...next, ...prev])];

    // Load current room stems first, then the rest
    await engine.loadStems(current, onProgress);
    const remaining = all.filter(s => !current.includes(s));
    if (remaining.length > 0) {
      engine.loadStems(remaining, onProgress); // fire-and-forget for next/prev
    }

    // Evict stems from rooms 2+ behind
    if (idx >= 3) {
      for (let i = 0; i <= idx - 3; i++) {
        evict(i);
      }
    }
  }

  function evict(idx) {
    const unique = getUniqueStemsForRoom(idx);
    if (unique.length > 0) {
      engine.unloadStems(unique);
    }
  }

  return {
    prepareForRoom,
    evict,
  };
}
