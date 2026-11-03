import type { BountyAward, ChatMessage, InvitationInfo, Player, Review, Table, User } from './types';
import { BOUNTY_UNITS, LocalPokerTable, uuid } from './engine';
import type { InternalPlayer, SavedRoomSummary } from './engine';
export { evaluateHand, handLabel, LocalPokerTable } from './engine';
export type { SavedRoomSummary } from './engine';
// --- Cloud MQTT-over-WSS + BroadcastChannel Serverless Coordinator ---
type RpcRequest = { id: string; userId: string; nickname: string; path: string; body?: unknown };
type RpcResponse = { id: string; ok: boolean; data?: unknown; error?: string };

const STORAGE_TABLES_KEY = 'river:p2p:tables:v1';
const STORAGE_SNAPSHOTS_KEY = 'river:p2p:snapshots:v1';
const MQTT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

function encodeVarLength(len: number): Uint8Array {
  const out: number[] = [];
  do {
    let digit = len % 128;
    len = Math.floor(len / 128);
    if (len > 0) digit |= 128;
    out.push(digit);
  } while (len > 0);
  return new Uint8Array(out);
}

function encodeUtf8(str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  const out = new Uint8Array(2 + bytes.length);
  out[0] = (bytes.length >> 8) & 0xff;
  out[1] = bytes.length & 0xff;
  out.set(bytes, 2);
  return out;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

class MqttSocketConn {
  private ws: WebSocket | null = null;
  private rxBuffer: Uint8Array = new Uint8Array(0);
  private connected = false;
  private subscribedTopics = new Set<string>();
  private pendingPublishes = new Map<string, { payloadStr: string; retain: boolean }>();
  private pktId = 1;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private url: string,
    private clientId: string,
    private onMessage: (topic: string, payload: string) => void
  ) {
    this.connect();
  }

  connect(): void {
    if (typeof WebSocket === 'undefined') return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    try {
      const ws = new WebSocket(this.url, 'mqtt');
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => {
        this.rxBuffer = new Uint8Array(0);
        const proto = encodeUtf8('MQTT');
        const flagsAndKeepalive = new Uint8Array([4, 2, 0, 45]);
        const cid = encodeUtf8(this.clientId);
        const body = concatBytes(proto, flagsAndKeepalive, cid);
        this.sendRaw(concatBytes(new Uint8Array([0x10]), encodeVarLength(body.length), body));
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
          if (this.connected) this.sendRaw(new Uint8Array([0xc0, 0x00]));
        }, 25000);
      };
      ws.onmessage = ev => {
        if (!(ev.data instanceof ArrayBuffer)) return;
        this.rxBuffer = concatBytes(this.rxBuffer, new Uint8Array(ev.data));
        this.parsePackets();
      };
      ws.onclose = () => {
        this.connected = false;
        this.scheduleReconnect();
      };
      ws.onerror = () => {
        this.connected = false;
        try { ws.close(); } catch {}
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1500);
  }

  private sendRaw(pkt: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(pkt); } catch {}
    }
  }

  private sendSubscribe(topic: string): void {
    const pid = (this.pktId++ & 0x7fff) || 1;
    const pidBytes = new Uint8Array([(pid >> 8) & 0xff, pid & 0xff]);
    const tBytes = encodeUtf8(topic);
    const body = concatBytes(pidBytes, tBytes, new Uint8Array([0x00]));
    this.sendRaw(concatBytes(new Uint8Array([0x82]), encodeVarLength(body.length), body));
  }

  private sendPublishNow(topic: string, payloadStr: string, retain: boolean): void {
    const tBytes = encodeUtf8(topic);
    const pBytes = new TextEncoder().encode(payloadStr);
    const rem = encodeVarLength(tBytes.length + pBytes.length);
    const header = new Uint8Array([retain ? 0x31 : 0x30]);
    this.sendRaw(concatBytes(header, rem, tBytes, pBytes));
  }

  subscribe(topic: string): void {
    this.subscribedTopics.add(topic);
    if (this.connected) {
      this.sendSubscribe(topic);
    } else {
      this.connect();
    }
  }

  publish(topic: string, payloadStr: string, retain = true): void {
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendPublishNow(topic, payloadStr, retain);
    } else {
      this.pendingPublishes.set(topic, { payloadStr, retain });
      this.connect();
    }
  }

  private parsePackets(): void {
    let offset = 0;
    while (offset + 2 <= this.rxBuffer.length) {
      const first = this.rxBuffer[offset];
      const type = first >> 4;
      const flags = first & 0x0f;
      let multiplier = 1;
      let value = 0;
      let idx = offset + 1;
      let complete = false;
      while (idx < this.rxBuffer.length) {
        const encodedByte = this.rxBuffer[idx++];
        value += (encodedByte & 127) * multiplier;
        if ((encodedByte & 128) === 0) {
          complete = true;
          break;
        }
        multiplier *= 128;
      }
      if (!complete || idx + value > this.rxBuffer.length) break;
      const pkt = this.rxBuffer.subarray(idx, idx + value);
      offset = idx + value;
      if (type === 2) {
        // CONNACK received
        this.connected = true;
        for (const t of this.subscribedTopics) {
          this.sendSubscribe(t);
        }
        for (const [topic, item] of this.pendingPublishes.entries()) {
          this.sendPublishNow(topic, item.payloadStr, item.retain);
        }
        this.pendingPublishes.clear();
      } else if (type === 3 && pkt.length >= 2) {
        const topicLen = (pkt[0] << 8) | pkt[1];
        if (2 + topicLen <= pkt.length) {
          const topic = new TextDecoder().decode(pkt.subarray(2, 2 + topicLen));
          const qos = (flags >> 1) & 0x03;
          const payloadStart = 2 + topicLen + (qos > 0 ? 2 : 0);
          if (payloadStart <= pkt.length) {
            const payload = new TextDecoder().decode(pkt.subarray(payloadStart));
            this.onMessage(topic, payload);
          }
        }
      }
    }
    if (offset > 0) {
      this.rxBuffer = this.rxBuffer.subarray(offset);
    }
  }
}

class ServerlessCoordinator {
  private hostedTables = new Map<string, LocalPokerTable>();
  private savedSnapshots = new Map<string, { table: Table; history: Review[]; updatedAt: number }>();
  private mqttConns: MqttSocketConn[] = [];
  private instanceId = `rc-${uuid().slice(0, 8)}`;
  private subscribedRooms = new Set<string>();
  private roomLoadWaiters = new Map<string, Set<() => void>>();
  private updateListeners = new Set<(table?: Table) => void>();
  private bc: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('river-club-p2p') : null;

  constructor() {
    this.loadPersistedState();
    for (let i = 0; i < MQTT_BROKERS.length; i++) {
      this.mqttConns.push(
        new MqttSocketConn(MQTT_BROKERS[i], `${this.instanceId}-${i}`, (topic, payload) => {
          this.handleMqttMessage(topic, payload);
        })
      );
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.mqttConns.forEach(c => c.connect());
          for (const code of this.subscribedRooms) {
            this.subscribeRoomCloud(code);
          }
        }
      });
      window.addEventListener('online', () => {
        this.mqttConns.forEach(c => c.connect());
      });
    }
    if (this.bc) {
      this.bc.onmessage = ev => {
        const msg = ev.data;
        if (msg?.type === 'state' && msg.code && msg.raw) {
          this.mergeIncomingTableState(String(msg.code).toUpperCase(), msg.raw as Record<string, unknown>);
        }
      };
    }
    try {
      const activeCode = (sessionStorage.getItem('river:room') || localStorage.getItem('river:room') || '').trim().toUpperCase();
      if (activeCode) {
        this.subscribeRoomCloud(activeCode);
      }
    } catch {}
    setInterval(() => {
      const now = Date.now();
      const me = this.getUser();
      for (const t of this.hostedTables.values()) {
        // Host ticks immediately; if host is offline/delayed by >1.5s, any seated player ticks so the game never stalls
        const isHost = me && t.host === me.id;
        const timerTarget = t.runoutAt || t.nextHandAt || t.deadline;
        const isBackupTicker = me && !isHost && timerTarget > 0 && now >= timerTarget + 1500 && t.players.some(p => p.id === me.id);
        if ((isHost || isBackupTicker) && t.tick(now)) {
          this.broadcastTableUpdate(t.code);
        }
      }
    }, 300);
  }

  private stateTopic(code: string): string {
    return `river-club/v3/room/${code.toUpperCase()}/state`;
  }

  private subscribeRoomCloud(code: string): void {
    const norm = code.trim().toUpperCase();
    if (!norm) return;
    this.subscribedRooms.add(norm);
    const topic = this.stateTopic(norm);
    this.mqttConns.forEach(c => c.subscribe(topic));
  }

  private publishRoomCloud(t: LocalPokerTable): void {
    const topic = this.stateTopic(t.code);
    const payload = JSON.stringify({
      sender: this.instanceId,
      ts: Date.now(),
      table: t.toJSON(),
    });
    this.mqttConns.forEach(c => c.publish(topic, payload, true));
  }

  private handleMqttMessage(topic: string, payload: string): void {
    const m = topic.match(/^river-club\/v3\/room\/([A-Z0-9]{8})\/state$/i);
    if (!m) return;
    const code = m[1].toUpperCase();
    try {
      const parsed = JSON.parse(payload) as { sender?: string; table?: Record<string, unknown> };
      if (parsed?.sender === this.instanceId && this.hostedTables.has(code)) {
        const waiters = this.roomLoadWaiters.get(code);
        if (waiters) {
          this.roomLoadWaiters.delete(code);
          waiters.forEach(resolve => resolve());
        }
        return;
      }
      const rawTable = parsed?.table ?? (parsed as Record<string, unknown>);
      if (!rawTable || typeof rawTable !== 'object' || !rawTable.code) return;
      this.mergeIncomingTableState(code, rawTable);
    } catch {}
  }

  private mergeIncomingTableState(code: string, rawTable: Record<string, unknown>): void {
    const incoming = LocalPokerTable.fromJSON(rawTable);
    const current = this.hostedTables.get(code);
    let shouldPublishMerged = false;

    if (current) {
      if (incoming.hand < current.hand) return;
      if (incoming.hand === current.hand && incoming.version < current.version) {
        if (!current.running() && !incoming.running()) {
          let currentUpdated = false;
          for (const ip of incoming.players) {
            const normNick = ip.nickname.trim().toLowerCase();
            const existsInCurrent = current.players.some(
              cp => cp.id === ip.id || cp.nickname.trim().toLowerCase() === normNick
            );
            if (!existsInCurrent && !ip.leaving && !current.kickedIds.has(ip.id) && current.players.length < 6) {
              current.join(ip.id, ip.nickname, ip.stack > 0 ? ip.stack : 100 * current.bb);
              currentUpdated = true;
            }
          }
          const curChatIds = new Set(current.chatLog.map(c => c.id));
          for (const c of incoming.chatLog) {
            if (!curChatIds.has(c.id)) {
              current.chatLog.push(c);
              currentUpdated = true;
            }
          }
          if (currentUpdated) {
            current.chatLog.sort((a, b) => a.time - b.time);
            current.version = Math.max(current.version, incoming.version) + 1;
            this.broadcastTableUpdate(code);
          }
        }
        return;
      }

      // Merge any chat messages not yet in incoming
      const chatIds = new Set(incoming.chatLog.map(c => c.id));
      for (const c of current.chatLog) {
        if (!chatIds.has(c.id)) {
          incoming.chatLog.push(c);
          shouldPublishMerged = true;
        }
      }
      incoming.chatLog.sort((a, b) => a.time - b.time);

      // If waiting/settled, preserve any recently joined local player who wasn't in incoming yet
      if (!incoming.running()) {
        for (const p of current.players) {
          const normNick = p.nickname.trim().toLowerCase();
          const existsInIncoming = incoming.players.some(
            ip => ip.id === p.id || ip.nickname.trim().toLowerCase() === normNick
          );
          if (!existsInIncoming && !p.leaving && !incoming.kickedIds.has(p.id) && incoming.players.length < 6) {
            incoming.join(p.id, p.nickname, p.stack > 0 ? p.stack : 100 * incoming.bb);
            shouldPublishMerged = true;
          }
        }
      }
    }

    this.hostedTables.set(code, incoming);
    this.savePersistedTables();

    const waiters = this.roomLoadWaiters.get(code);
    if (waiters) {
      this.roomLoadWaiters.delete(code);
      waiters.forEach(resolve => resolve());
    }

    const me = this.getUser();
    let myView: Table | undefined;
    if (me && incoming.players.some(p => p.id === me.id)) {
      try { myView = incoming.view(me.id); } catch {}
    }
    if (myView) this.saveClientSnapshot(myView, incoming.history);
    this.emitUpdate(myView);

    if (shouldPublishMerged) {
      this.publishRoomCloud(incoming);
    }
  }

  private async ensureRoomLoaded(code: string, currentUser: User): Promise<LocalPokerTable> {
    const norm = code.trim().toUpperCase();
    this.subscribeRoomCloud(norm);

    if (this.hostedTables.has(norm)) {
      return this.hostedTables.get(norm)!;
    }

    // Wait up to 1100ms for cloud retained state to arrive from EMQX / HiveMQ
    await new Promise<void>(resolve => {
      let set = this.roomLoadWaiters.get(norm);
      if (!set) {
        set = new Set();
        this.roomLoadWaiters.set(norm, set);
      }
      const done = () => {
        clearTimeout(timer);
        set?.delete(done);
        resolve();
      };
      const timer = setTimeout(done, 1100);
      set.add(done);
    });

    if (this.hostedTables.has(norm)) {
      return this.hostedTables.get(norm)!;
    }

    // Fallback 1: Restore from local snapshot if available
    if (this.promoteSnapshotToHosted(norm, currentUser)) {
      const t = this.hostedTables.get(norm)!;
      this.publishRoomCloud(t);
      return t;
    }

    // Fallback 2: Automatically initialize the room on the cloud broker so old room codes/links always work!
    const hostId = currentUser.id !== 'anon' ? currentUser.id : uuid();
    const hostNick = currentUser.nickname && currentUser.nickname !== 'Guest' ? currentUser.nickname : '포커';
    const created = new LocalPokerTable(norm, `${hostNick}의 테이블`, hostId, '');
    if (currentUser.id !== 'anon') {
      created.join(currentUser.id, currentUser.nickname, 100 * created.bb);
    }
    this.hostedTables.set(norm, created);
    this.savePersistedTables();
    this.publishRoomCloud(created);
    return created;
  }

  private loadPersistedState(): void {
    try {
      const rawTables = localStorage.getItem(STORAGE_TABLES_KEY);
      if (rawTables) {
        const parsed = JSON.parse(rawTables) as Record<string, Record<string, unknown>>;
        for (const [code, data] of Object.entries(parsed)) {
          const table = LocalPokerTable.fromJSON(data);
          this.hostedTables.set(code.toUpperCase(), table);
        }
      }
    } catch {}
    try {
      const rawSnaps = localStorage.getItem(STORAGE_SNAPSHOTS_KEY);
      if (rawSnaps) {
        const parsed = JSON.parse(rawSnaps) as Record<string, { table: Table; history: Review[]; updatedAt: number }>;
        for (const [code, snap] of Object.entries(parsed)) {
          if (snap?.table) this.savedSnapshots.set(code.toUpperCase(), snap);
        }
      }
    } catch {}
  }

  private savePersistedTables(): void {
    try {
      const entries = [...this.hostedTables.entries()]
        .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
        .slice(0, 15);
      const obj: Record<string, unknown> = {};
      for (const [code, t] of entries) {
        obj[code] = t.toJSON();
      }
      localStorage.setItem(STORAGE_TABLES_KEY, JSON.stringify(obj));
    } catch {}
  }

  private saveClientSnapshot(table: Table, history?: Review[]): void {
    try {
      const code = table.code.toUpperCase();
      const existing = this.savedSnapshots.get(code);
      this.savedSnapshots.set(code, {
        table,
        history: history ?? existing?.history ?? [],
        updatedAt: Date.now(),
      });
      const entries = [...this.savedSnapshots.entries()]
        .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
        .slice(0, 15);
      const obj: Record<string, unknown> = {};
      for (const [c, snap] of entries) obj[c] = snap;
      localStorage.setItem(STORAGE_SNAPSHOTS_KEY, JSON.stringify(obj));
    } catch {}
  }

  getSavedRooms(): SavedRoomSummary[] {
    const map = new Map<string, SavedRoomSummary>();
    for (const [code, snap] of this.savedSnapshots.entries()) {
      const tbl = snap.table;
      map.set(code, {
        code,
        name: tbl.name,
        sb: tbl.sb,
        bb: tbl.bb,
        hand: tbl.hand,
        updatedAt: snap.updatedAt,
        players: tbl.players.map(p => ({ nickname: p.nickname, bounty: p.bounty, stack: p.stack })),
      });
    }
    for (const [code, t] of this.hostedTables.entries()) {
      const allPlayers = [...t.players, ...t.archivedPlayers];
      map.set(code, {
        code,
        name: t.name,
        sb: t.sb,
        bb: t.bb,
        hand: t.hand,
        updatedAt: t.updatedAt,
        players: allPlayers.map(p => ({ nickname: p.nickname, bounty: p.bountyUnits / BOUNTY_UNITS, stack: p.stack })),
      });
    }
    return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  removeSavedRoom(code: string): void {
    const norm = code.trim().toUpperCase();
    this.hostedTables.delete(norm);
    this.savedSnapshots.delete(norm);
    this.savePersistedTables();
    try {
      const obj: Record<string, unknown> = {};
      for (const [c, snap] of this.savedSnapshots.entries()) obj[c] = snap;
      localStorage.setItem(STORAGE_SNAPSHOTS_KEY, JSON.stringify(obj));
    } catch {}
  }

  onUpdate(fn: (table?: Table) => void): () => void {
    this.updateListeners.add(fn);
    return () => this.updateListeners.delete(fn);
  }

  private emitUpdate(table?: Table): void {
    if (table) this.saveClientSnapshot(table);
    this.updateListeners.forEach(fn => fn(table));
  }

  private getUser(): User | null {
    try {
      const raw = localStorage.getItem('river:p2p:user') ?? sessionStorage.getItem('river:p2p:user');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as User;
      sessionStorage.setItem('river:p2p:user', raw);
      localStorage.setItem('river:p2p:user', raw);
      return parsed;
    } catch {
      return null;
    }
  }

  private setUser(u: User | null): void {
    try {
      if (!u) {
        sessionStorage.removeItem('river:p2p:user');
        localStorage.removeItem('river:p2p:user');
      } else {
        const str = JSON.stringify(u);
        sessionStorage.setItem('river:p2p:user', str);
        localStorage.setItem('river:p2p:user', str);
      }
    } catch {}
  }

  private extractCode(path: string): string | null {
    const m = path.match(/^\/api\/(?:rooms|invitations)\/([A-Z0-9]{8})/i);
    return m ? m[1].toUpperCase() : null;
  }

  private broadcastTableUpdate(code: string): void {
    const t = this.hostedTables.get(code);
    if (!t) return;
    t.updatedAt = Date.now();
    this.savePersistedTables();
    this.publishRoomCloud(t);
    this.bc?.postMessage({ type: 'state', code, raw: t.toJSON() });

    const hostUser = this.getUser();
    let hostView: Table | undefined;
    if (hostUser && t.players.some(p => p.id === hostUser.id)) {
      try { hostView = t.view(hostUser.id); } catch {}
    }
    if (hostView) this.saveClientSnapshot(hostView, t.history);
    this.emitUpdate(hostView);
  }

  private handleLocalRpc(req: RpcRequest): RpcResponse {
    try {
      const code = this.extractCode(req.path)!;
      const t = this.hostedTables.get(code);
      if (!t) throw new Error('방 코드를 확인해주세요');
      this.subscribeRoomCloud(code);

      if (req.path.startsWith('/api/invitations/')) {
        const info: InvitationInfo = {
          code: t.code,
          name: t.name,
          playerCount: t.players.length,
          capacity: 6,
          sb: t.sb,
          bb: t.bb,
          passwordRequired: false,
          running: t.running(),
        };
        return { id: req.id, ok: true, data: info };
      }

      const sub = req.path.replace(new RegExp(`^/api/rooms/${code}`, 'i'), '');
      const body = (req.body ?? {}) as Record<string, unknown>;

      if (sub === '') {
        if (req.userId && t.kickedIds.has(req.userId)) {
          throw new Error('방장에 의해 강제 퇴장되었습니다');
        }
        if (req.userId && req.userId !== 'anon' && !t.players.some(p => p.id === req.userId)) {
          t.join(req.userId, req.nickname || 'Player', 100 * t.bb);
          this.broadcastTableUpdate(code);
        }
        const view = t.view(req.userId);
        this.savePersistedTables();
        return { id: req.id, ok: true, data: view };
      }
      if (sub === '/join') {
        const nick = String(body.nickname ?? req.nickname).trim();
        t.kickedIds.delete(req.userId);
        t.join(req.userId, nick, 100 * t.bb);
        this.broadcastTableUpdate(code);
        return { id: req.id, ok: true, data: t.view(req.userId) };
      }
      if (sub === '/reset-stacks' || sub === '/reset-bounties') {
        if (body.confirmed !== true) throw new Error('초기화를 재확인해주세요');
        if (sub === '/reset-stacks') t.resetStacks(req.userId);
        else t.resetBounties(req.userId);
        this.broadcastTableUpdate(code);
        return { id: req.id, ok: true, data: t.view(req.userId) };
      }
      if (sub === '/pause') {
        t.pause(req.userId);
        this.broadcastTableUpdate(code);
        return { id: req.id, ok: true, data: t.view(req.userId) };
      }
      if (sub === '/kick') {
        t.kick(req.userId, String(body.userId ?? ''));
        this.broadcastTableUpdate(code);
        return { id: req.id, ok: true, data: t.view(req.userId) };
      }
      if (sub === '/chat') {
        t.chat(req.userId, String(body.text ?? ''));
        this.broadcastTableUpdate(code);
        return { id: req.id, ok: true, data: t.view(req.userId) };
      }
      if (sub === '/ready') {
        if (t.running()) throw new Error('핸드 중에는 준비를 변경할 수 없습니다');
        t.member(req.userId).ready = Boolean(body.ready);
        t.version++;
        this.broadcastTableUpdate(code);
        return { id: req.id, ok: true, data: t.view(req.userId) };
      }
      if (sub === '/start') {
        t.start(req.userId);
        this.broadcastTableUpdate(code);
        return { id: req.id, ok: true, data: t.view(req.userId) };
      }
      if (sub === '/blinds') {
        t.blinds(req.userId, Number(body.sb), Number(body.bb));
        this.broadcastTableUpdate(code);
        return { id: req.id, ok: true, data: t.view(req.userId) };
      }
      if (sub === '/actions') {
        t.action(
          req.userId,
          String(body.action),
          body.amountTo !== undefined && body.amountTo !== null ? Number(body.amountTo) : undefined,
          Number(body.version),
          Number(body.hand)
        );
        this.broadcastTableUpdate(code);
        return { id: req.id, ok: true, data: t.view(req.userId) };
      }
      if (sub === '/showdown') {
        t.showdown(req.userId, Boolean(body.showdown));
        this.broadcastTableUpdate(code);
        return { id: req.id, ok: true, data: t.view(req.userId) };
      }
      if (sub === '/leave') {
        t.leave(req.userId);
        this.broadcastTableUpdate(code);
        return { id: req.id, ok: true, data: null };
      }
      if (sub === '/history') {
        if (req.userId && req.userId !== 'anon' && !t.players.some(p => p.id === req.userId)) {
          return { id: req.id, ok: true, data: [...t.history] };
        }
        return { id: req.id, ok: true, data: [...t.history] };
      }
      throw new Error('지원하지 않는 요청입니다');
    } catch (e) {
      return { id: req.id, ok: false, error: e instanceof Error ? e.message : '요청 실패' };
    }
  }

  private promoteSnapshotToHosted(code: string, currentUser: User): boolean {
    if (this.hostedTables.has(code)) return true;
    const snap = this.savedSnapshots.get(code);
    if (!snap?.table) return false;
    const restored = LocalPokerTable.fromTableSnapshot(snap.table, snap.history);
    if (currentUser.id !== 'anon') {
      restored.host = currentUser.id;
      restored.join(currentUser.id, currentUser.nickname, 100 * restored.bb);
    }
    this.hostedTables.set(code, restored);
    this.savePersistedTables();
    return true;
  }

  async request<T>(path: string, body?: unknown): Promise<T> {
    if (path === '/api/auth/csrf') {
      return { headerName: 'X-CSRF-TOKEN', token: 'serverless' } as T;
    }
    if (path === '/api/auth/me') {
      const u = this.getUser();
      if (!u) {
        const err = new Error('로그인이 필요합니다') as Error & { status?: number };
        err.status = 401;
        throw err;
      }
      return u as T;
    }
    if (path === '/api/auth/guest') {
      const nick = String((body as Record<string, unknown>)?.nickname ?? '').trim();
      if (nick.length < 2 || nick.length > 20) throw new Error('닉네임은 2~20자입니다');
      const existing = this.getUser();
      const user: User = { id: existing?.id ?? uuid(), nickname: nick };
      this.setUser(user);
      return user as T;
    }
    if (path === '/api/auth/logout') {
      this.setUser(null);
      return undefined as T;
    }
    if (path === '/api/rooms' && body !== undefined) {
      const user = this.getUser();
      if (!user) throw new Error('로그인이 필요합니다');
      const b = body as Record<string, unknown>;
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
      const table = new LocalPokerTable(code, String(b.name ?? `${user.nickname}의 테이블`), user.id, String(b.password ?? ''));
      table.join(user.id, user.nickname, 100 * table.bb);
      this.hostedTables.set(code, table);
      this.subscribeRoomCloud(code);
      this.broadcastTableUpdate(code);
      const view = table.view(user.id);
      return view as T;
    }

    const code = this.extractCode(path);
    if (!code) throw new Error('잘못된 경로입니다');
    const user = this.getUser() ?? { id: 'anon', nickname: 'Guest' };
    const req: RpcRequest = body === undefined
      ? { id: uuid(), userId: user.id, nickname: user.nickname, path }
      : { id: uuid(), userId: user.id, nickname: user.nickname, path, body };

    await this.ensureRoomLoaded(code, user);
    const res = this.handleLocalRpc(req);
    if (!res.ok) throw new Error(res.error);
    return res.data as T;
  }
}

export const serverless = new ServerlessCoordinator();
