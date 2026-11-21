/**
 * 后台服务：所有对本地桥接服务的请求都走这里。
 *
 * 为什么不在 content script 里直接 fetch：
 *   网页可能是 https，从 https 页面请求 http://127.0.0.1 会被浏览器当成混合内容拦掉。
 *   扩展的 service worker 有 host_permissions，不受页面混合内容限制。
 */

const BASE = 'http://127.0.0.1:8080';

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'lookup') {
    (async () => {
      try {
        // 两个接口并行，任一失败都不影响另一个
        const [lk, multi] = await Promise.all([
          post('/api/dict/lookup', { words: [msg.word] }).catch(() => ({ items: [] })),
          post('/api/dict/multi', { word: msg.word }).catch(() => null)
        ]);
        sendResponse({
          ok: true,
          entry: (lk.items || [])[0] || null,
          auth: multi && multi.items && multi.items.length ? multi : null
        });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true;   // 保持消息通道开着，等异步结果
  }

  // 段落：调本地模型翻译 + 后端词库分析重难点词
  if (msg.type === 'analyze') {
    (async () => {
      try {
        const data = await post('/api/dict/analyze_paragraph', {
          text: String(msg.text || '').slice(0, 6000),
          translate: msg.translate !== false
        });
        // 直接把后端字段摊平，content.js 用 res.words / res.translation
        sendResponse(Object.assign({ ok: true }, data || {}));
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true;
  }

  if (msg.type === 'ping') {
    (async () => {
      try {
        sendResponse({ ok: true, data: await post('/api/ping') });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true;
  }
});

// 点扩展图标：探一下服务在不在，用角标显示状态
chrome.action.onClicked.addListener(async () => {
  try {
    await post('/api/ping');
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#0f766e' });
  } catch {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
  }
});
