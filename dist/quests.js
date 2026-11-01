export const QUEST_KINDS = {1:'Pickup', 2:'Objective', 3:'Turn-in'};

// The strip repeats a bounded snapshot, tolerating skipped frames and joining
// mid-cycle. A new generation drops removed quests before any new pins appear.
export class QuestFeed {
  constructor() { this.reset(); }
  reset() {
    this.mapId = null; this.generation = null; this.count = 0; this.status = null;
    this.limited = false; this.markers = new Map(); this.fragments = new Map();
    this.titles = new Map(); this.receivedAt = -Infinity; this.lastSequence = null;
  }
  accept(packet, now) {
    if (packet.type !== 'quest') return false;
    if (packet.kind === 0) {
      if (this.mapId !== packet.mapId || this.generation !== packet.generation) {
        this.reset(); this.mapId = packet.mapId; this.generation = packet.generation;
      }
      this.count = packet.count; this.status = packet.status; this.limited = packet.limited;
    } else if (this.mapId !== packet.mapId || this.generation !== packet.generation || this.status !== 1 || packet.index > this.count) {
      return false;
    }
    if (this.lastSequence === packet.sequence) return false;
    this.lastSequence = packet.sequence; this.receivedAt = now;
    if (packet.kind === 1) this.markers.set(packet.index, packet);
    if (packet.kind === 2) {
      const parts = this.fragments.get(packet.index) || {chunks:new Map(), final:null};
      parts.chunks.set(packet.fragment, packet.textBytes);
      if (packet.final) parts.final = packet.fragment;
      this.fragments.set(packet.index, parts);
    }
    // A label can arrive before its marker because a frame was skipped.
    for (const [index, parts] of this.fragments) {
      const marker = this.markers.get(index);
      if (!marker || parts.final === null) continue;
      const bytes = [];
      for (let i=0; i<=parts.final; i++) {
        if (!parts.chunks.has(i)) break;
        bytes.push(...parts.chunks.get(i));
        if (i === parts.final) {
          const end = bytes.indexOf(0);
          this.titles.set(marker.questId, new TextDecoder().decode(new Uint8Array(end < 0 ? bytes : bytes.slice(0,end))));
        }
      }
    }
    return true;
  }
  isFresh(now) { return now - this.receivedAt < 6000; }
  visible(mapId, now) {
    if (this.mapId !== mapId || this.status !== 1 || !this.isFresh(now)) return [];
    return [...this.markers.values()].map(marker => ({...marker, title:this.titles.get(marker.questId) || `Quest #${marker.questId}`}));
  }
}
