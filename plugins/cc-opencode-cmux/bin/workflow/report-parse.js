/**
 * oc-delegate.sh 의 7줄 stdout 리포트를 구조화 객체로 파싱한다.
 * @param {string} stdout - status/session/oc_sid/files/diff/done/notes 7줄
 * @returns {{status,session,oc_sid,add,del,files,diff,done,notes:string|number}}
 */
export function parseReport(stdout) {
  const lines = String(stdout).split('\n');
  const get = (key) => {
    const line = lines.find((l) => l.startsWith(key + ':'));
    return line ? line.slice(key.length + 1).trim() : '';
  };
  const files = get('files'); // "+12 -3 (4 files)"
  const m = files.match(/\+(\d+)\s+-(\d+)\s+\((\d+)\s+files?\)/);
  return {
    status: get('status'),
    session: get('session'),
    oc_sid: get('oc_sid'),
    add: m ? Number(m[1]) : 0,
    del: m ? Number(m[2]) : 0,
    files: m ? Number(m[3]) : 0,
    diff: get('diff'),
    done: get('done'),
    notes: get('notes'),
  };
}
