// Isolated synthetic transport for UI tests. Authorization is exercised against PostgreSQL in backend tests.
import { createServer } from 'node:http';
const org = { id: '11111111-1111-4111-8111-111111111111', name: 'Organização de teste', active: true, createdAt: '2026-10-18T12:00:00Z', updatedAt: '2026-10-18T12:00:00Z', permissions: ['organization.read', 'customers.read', 'customers.invite', 'customers.manage'], role: 'ORGANIZATION_ADMIN', userId: '22222222-2222-4222-8222-222222222222' };
createServer(async (req, res) => {
 res.setHeader('Content-Type', 'application/json'); res.setHeader('Access-Control-Allow-Origin', 'http://localhost:19030'); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
 if (req.method === 'OPTIONS') { res.end(); return; }
 const json = value => res.end(JSON.stringify(value));
 if (req.url?.endsWith('/welcome')) return json({ username: 'Admin de teste', email: 'admin@example.invalid', emailVerifiedAt: null, accountType: 'common', mfa: { configured: false, verified: false }, platformPermissions: [] });
 if (req.url === '/v1/organizations') return json({ items: [org] });
 if (req.url?.startsWith('/v1/organizations/')) return json(org);
 if (req.url === '/v1/audit/access') return json({ organization: org.name });
 return json({ ok: true });
}).listen(19031, '127.0.0.1');
