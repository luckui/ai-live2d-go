#!/usr/bin/env node
/**
 * B站弹幕 WebSocket 服务器连通性测试脚本
 *
 * 用法:
 *   node electron/streaming/platforms/bilibili/testWss.js <room_id> [cookie]
 *
 * 示例:
 *   node electron/streaming/platforms/bilibili/testWss.js 26835777
 *   node electron/streaming/platforms/bilibili/testWss.js 26835777 "SESSDATA=xxx;DedeUserID=yyy"
 *
 * 输出：每台服务器的连接耗时和认证结果，帮助判断哪些节点可用
 */

'use strict';

const https = require('https');
const WebSocket = require('ws');

// ─── CLI 参数 ────────────────────────────────────────────────────────────────
const roomIdArg = parseInt(process.argv[2] || '0', 10);
const cookie    = process.argv[3] || '';

if (!roomIdArg) {
  console.error('用法: node testWss.js <room_id> [cookie]');
  process.exit(1);
}

// ─── 内置兜底服务器（API 节点全挂时最后尝试） ────────────────────────────────
const FALLBACK_SERVERS = [
  { host: 'broadcastlv.chat.bilibili.com', wss_port: 443 },
  { host: 'broadcastlv.chat.bilibili.com', wss_port: 2245 },
];

// ─── HTTP 工具 ───────────────────────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(cookie ? { Cookie: cookie } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}\nBody: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ─── 协议：构造认证包 ─────────────────────────────────────────────────────────
function makeAuthPacket(roomId, uid, token) {
  const body = Buffer.from(JSON.stringify({
    uid, roomid: roomId, protover: 3, platform: 'web', type: 2, key: token,
  }), 'utf-8');
  const total = 16 + body.length;
  const header = Buffer.alloc(16);
  header.writeUInt32BE(total, 0);
  header.writeUInt16BE(16, 4);
  header.writeUInt16BE(0, 6);    // protover=0 for auth packet
  header.writeUInt32BE(7, 8);    // OP_AUTH
  header.writeUInt32BE(1, 12);
  return Buffer.concat([header, body]);
}

// ─── 单台服务器测试 ───────────────────────────────────────────────────────────
function testServer(host, wssPort, roomId, uid, token) {
  return new Promise((resolve) => {
    const url = `wss://${host}:${wssPort}/sub`;
    const startAt = Date.now();
    let phase = 'connecting';

    const ws = new WebSocket(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://live.bilibili.com',
        'Referer': `https://live.bilibili.com/${roomId}`,
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });

    const timeout = setTimeout(() => {
      ws.terminate();
      resolve({ url, ok: false, ms: Date.now() - startAt, reason: `timeout at phase=${phase}` });
    }, 8000);

    ws.on('open', () => {
      phase = 'auth';
      ws.send(makeAuthPacket(roomId, uid, token));
    });

    ws.on('message', (data) => {
      // 只需要读认证响应头 (OP=8)
      try {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const op = buf.readUInt32BE(8);
        if (op === 8) {
          clearTimeout(timeout);
          ws.close();
          resolve({ url, ok: true, ms: Date.now() - startAt, reason: 'authenticated' });
        }
      } catch {
        // ignore parse errors for this quick test
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ url, ok: false, ms: Date.now() - startAt, reason: err.message });
    });

    ws.on('close', (code) => {
      clearTimeout(timeout);
      if (phase !== 'auth' || code !== 1000) {
        resolve({ url, ok: false, ms: Date.now() - startAt, reason: `closed ${code} at phase=${phase}` });
      }
      // if ok=true already resolved above, this fires again but resolve is idempotent
    });
  });
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔍 B站 WebSocket 服务器连通性测试`);
  console.log(`   房间号: ${roomIdArg}  Cookie: ${cookie ? '已提供' : '未提供（匿名）'}\n`);

  // 1. 获取真实 room_id
  process.stdout.write('获取真实 room_id ... ');
  const roomInfo = await fetchJson(
    `https://api.live.bilibili.com/room/v1/Room/get_info?id=${roomIdArg}`
  );
  if (roomInfo.code !== 0 || !roomInfo.data) {
    console.error(`❌ 失败: code=${roomInfo.code}`);
    process.exit(1);
  }
  const realRoomId = roomInfo.data.room_id;
  console.log(`✅ ${realRoomId}`);

  // 2. 获取 token + 服务器列表
  process.stdout.write('获取弹幕配置 ... ');
  let token = '';
  let apiServers = [];

  if (cookie) {
    try {
      const cfg = await fetchJson(
        `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=${realRoomId}&type=0`
      );
      if (cfg.code === 0 && cfg.data) {
        token = cfg.data.token;
        apiServers = cfg.data.host_list.map(s => ({ host: s.host, wss_port: s.wss_port }));
        console.log(`✅ 新版 API，${apiServers.length} 台服务器`);
      }
    } catch {}
  }

  if (!token) {
    try {
      const cfg = await fetchJson(
        `https://api.live.bilibili.com/room/v1/Danmu/getConf?room_id=${realRoomId}&platform=pc&player=web`
      );
      if (cfg.code === 0 && cfg.data) {
        token = cfg.data.token;
        apiServers = cfg.data.host_server_list.map(s => ({ host: s.host, wss_port: s.wss_port }));
        console.log(`✅ 旧版 API，${apiServers.length} 台服务器`);
      }
    } catch {}
  }

  if (!token) {
    console.error('❌ 无法获取 token，仅测试兜底服务器（认证会失败，但可测通断）');
    token = 'test-token-invalid';
  }

  // 3. 提取 uid
  const uidMatch = /DedeUserID=(\d+)/.exec(cookie);
  const uid = uidMatch ? parseInt(uidMatch[1], 10) : 0;

  // 4. 合并服务器列表
  const allServers = [
    ...apiServers,
    ...FALLBACK_SERVERS.filter(f => !apiServers.some(a => a.host === f.host)),
  ];

  console.log(`\n测试 ${allServers.length} 台服务器（并发）:\n`);

  // 5. 并发测试所有服务器
  const results = await Promise.all(
    allServers.map(s => testServer(s.host, s.wss_port, realRoomId, uid, token))
  );

  // 6. 打印结果
  const ok = results.filter(r => r.ok);
  const fail = results.filter(r => !r.ok);

  console.log('─'.repeat(72));
  for (const r of results.sort((a, b) => (a.ok ? 0 : 1) - (b.ok ? 0 : 1) || a.ms - b.ms)) {
    const icon = r.ok ? '✅' : '❌';
    const ms   = r.ms.toString().padStart(5) + ' ms';
    const host = r.url.replace('wss://', '').replace('/sub', '').padEnd(52);
    console.log(`${icon}  ${ms}  ${host}  ${r.reason}`);
  }
  console.log('─'.repeat(72));
  console.log(`\n结果：${ok.length} 台可用 / ${fail.length} 台不可用 / 共 ${results.length} 台\n`);

  if (ok.length === 0) {
    console.log('⚠️  所有服务器均不可达，可能是：');
    console.log('   1. 网络问题（防火墙/代理）');
    console.log('   2. Cookie 过期或未提供导致 token 无效');
    console.log('   3. B站暂时性故障');
  } else {
    console.log(`推荐优先使用: ${ok.sort((a,b) => a.ms - b.ms)[0].url}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
