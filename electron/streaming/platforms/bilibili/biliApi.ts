/**
 * B站直播 API 接口
 * 基于 danmu_test/test_connect.py 的验证逻辑
 */

import https from 'https';
import http from 'http';

interface RoomInfoResponse {
  code: number;
  data?: {
    room_id: number;
    uid: number;
  };
}

interface DanmuConfigResponse {
  code: number;
  data?: {
    token: string;
    host_list: Array<{ host: string; port: number; wss_port: number }>;
  };
}

interface OldDanmuConfigResponse {
  code: number;
  data?: {
    token: string;
    host_server_list: Array<{ host: string; port: number; wss_port: number }>;
  };
}

/**
 * 短号 → 真实 room_id
 */
export async function getRealRoomId(shortId: number): Promise<number> {
  const url = `https://api.live.bilibili.com/room/v1/Room/get_info?id=${shortId}`;
  const data = await fetchJson<RoomInfoResponse>(url);
  
  if (data.code !== 0 || !data.data) {
    throw new Error(`Failed to get room info: code=${data.code}`);
  }
  
  return data.data.room_id;
}

/**
 * 获取弹幕配置（token + WebSocket 服务器列表）
 * 优先使用新版 API（需要 Cookie），失败则降级到旧版
 */
export async function getDanmuConfig(
  roomId: number,
  cookie?: string
): Promise<{ token: string; servers: Array<{ host: string; port: number; wss_port: number }> }> {
  // 1. 尝试新版 API（需要 Cookie）
  if (cookie) {
    try {
      const newUrl = `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=${roomId}&type=0`;
      const data = await fetchJson<DanmuConfigResponse>(newUrl, cookie);
      
      if (data.code === 0 && data.data) {
        return {
          token: data.data.token,
          servers: data.data.host_list,
        };
      }
    } catch (err) {
      console.warn('[biliApi] New API failed, fallback to old API:', (err as Error).message);
    }
  }

  // 2. 降级到旧版 API（无需 Cookie，但会匿名化用户名）
  const oldUrl = `https://api.live.bilibili.com/room/v1/Danmu/getConf?room_id=${roomId}&platform=pc&player=web`;
  const data = await fetchJson<OldDanmuConfigResponse>(oldUrl, cookie);
  
  if (data.code !== 0 || !data.data) {
    throw new Error(`Failed to get danmu config: code=${data.code}`);
  }

  if (!cookie) {
    console.warn(
      '[biliApi] Using old API without Cookie. Usernames may be anonymized after a few minutes. ' +
      'Provide Cookie via manage_bilibili_live(cookie=...) to avoid this.'
    );
  }

  return {
    token: data.data.token,
    servers: data.data.host_server_list,
  };
}

/**
 * 通用 JSON 获取（支持 Cookie）
 */
function fetchJson<T>(url: string, cookie?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(cookie ? { Cookie: cookie } : {}),
      },
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data) as T);
        } catch (err) {
          reject(new Error(`JSON parse error: ${err}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}
