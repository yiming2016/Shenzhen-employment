/**
 * Cloudflare Worker 示例：远程政策参数服务。
 * 部署后访问 https://你的域名/policy-params.json 即可返回参数 JSON。
 *
 * 使用步骤：
 * 1. 先在电脑版目录执行：npm run gen:params
 *    生成 server/policy-params.example.json
 * 2. 把该 JSON 内容粘贴到下面的 POLICY_PARAMS 中（替换示例数据）
 * 3. 用 wrangler 部署：npx wrangler deploy
 */
const POLICY_PARAMS = {
  version: '2026-08（示例，请替换成你导出的参数）',
  minimumWage: 2520,
  averageWage: {
    urbanNonPrivate: 191367,
    urbanNonPrivateOnPost: 193881,
    urbanPrivate: 99220,
  },
  pension: {
    personalRate: 0.08,
    companyRateDeep: 0.17,
    companyRateNonDeep: 0.16,
    flexibleRateDeep: 0.21,
    flexibleRateNonDeep: 0.2,
    baseMin: 4775,
    baseMax: 27549,
  },
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, OPTIONS',
        },
      });
    }
    if (url.pathname === '/policy-params.json') {
      return new Response(JSON.stringify(POLICY_PARAMS, null, 2), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*',
        },
      });
    }
    return new Response('not found', { status: 404 });
  },
};
