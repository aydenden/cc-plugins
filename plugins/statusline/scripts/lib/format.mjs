/**
 * 위젯이 값을 글자로 바꿀 때 쓰는 순수 함수들 — 토큰 수, 기간, 막대, 경로, 모델 이름.
 *
 * `node:` import 를 두지 않는다. hooks module 이 import 하므로 mod 의 실행 환경에서 돌아야 한다.
 */

/**
 * 토큰 수를 짧게 쓴다 (`950`, `12.3k`, `1.2M`).
 *
 * @param {number} count
 * @returns {string}
 */
export function formatTokens(count) {
  if (count < 1000) return String(Math.round(count));
  if (count < 1_000_000) return `${trimZero((count / 1000).toFixed(1))}k`;
  return `${trimZero((count / 1_000_000).toFixed(1))}M`;
}

/**
 * 기간을 큰 단위 둘로 쓴다 (`2d 3hr`, `1hr 5m`, `12m`, `40s`). 음수는 0 으로 본다.
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}hr`;
  if (hours > 0) return `${hours}hr ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}

/**
 * 퍼센트를 소수 한 자리까지 쓴다 (`18%`, `23.5%`).
 *
 * @param {number} percent
 * @returns {string}
 */
export function formatPercent(percent) {
  return `${trimZero(percent.toFixed(1))}%`;
}

/**
 * 채움 막대 (`███░░░░░░░`). 0~100 밖의 값은 끝에 붙인다.
 *
 * @param {number} percent
 * @param {number} [width]
 * @returns {string}
 */
export function bar(percent, width = 10) {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/**
 * 금액 (`$2.61`). 통화 코드가 USD 가 아니면 코드를 뒤에 붙인다.
 *
 * @param {number} amount
 * @param {string} [currency]
 * @returns {string}
 */
export function formatMoney(amount, currency = 'USD') {
  return currency === 'USD' ? `$${amount.toFixed(2)}` : `${amount.toFixed(2)} ${currency}`;
}

/**
 * 바이트를 GiB 로 (`12.3G`).
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatGigabytes(bytes) {
  return `${trimZero((bytes / 1024 ** 3).toFixed(1))}G`;
}

/**
 * 경로의 마지막 조각.
 *
 * @param {string} path
 * @returns {string}
 */
export function basename(path) {
  const parts = path.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

/**
 * 홈 아래 경로를 `~` 로 줄인다.
 *
 * @param {string} path
 * @param {string | undefined} home
 * @returns {string}
 */
export function tildePath(path, home) {
  if (!home) return path;
  if (path === home) return '~';
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/**
 * 모델 id 를 읽기 좋게 (`claude-opus-5-5` → `Opus 5.5`). 모르는 꼴은 그대로 둔다.
 *
 * @param {string} model
 * @returns {string}
 */
export function prettyModel(model) {
  const bare = model.replace(/\[[^\]]*\]$/, '').replace(/\s*\([^)]*\)$/, '');
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(bare);
  if (!match) return bare;
  const [, family, major, minor] = match;
  const name = family[0].toUpperCase() + family.slice(1);
  return minor === undefined ? `${name} ${major}` : `${name} ${major}.${minor}`;
}

/**
 * `max` 칸을 넘으면 끝을 `…` 로 자른다. `max` 가 없으면 그대로.
 *
 * @param {string} text
 * @param {number | undefined} max
 * @returns {string}
 */
export function truncate(text, max) {
  if (!max || max < 1) return text;
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

function trimZero(text) {
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}
