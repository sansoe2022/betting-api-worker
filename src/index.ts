export interface Env {
  DB: D1Database;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    try {
      /* 1. ADMIN API: GET Submissions */
      if (path === '/api/admin/submissions' && method === 'GET') {
        const date = url.searchParams.get('date');
        const session = url.searchParams.get('session');
        if (!date || !session) return new Response('Missing date or session', { status: 400, headers: corsHeaders });

        const { results } = await env.DB.prepare(`SELECT * FROM betting_submissions WHERE bet_date = ? AND session = ? ORDER BY created_at DESC`).bind(date, session).all();
        return Response.json(results, { headers: corsHeaders });
      }

      /* 2. ADMIN API: PATCH Status */
      const statusMatch = path.match(/^\/api\/admin\/submissions\/(?<id>[^/]+)\/status$/);
      if (statusMatch && method === 'PATCH') {
        const id = statusMatch.groups?.id;
        const body: { status: string; reason?: string } = await request.json();

        if (!['approved', 'rejected', 'pending'].includes(body.status)) return new Response('Invalid status', { status: 400, headers: corsHeaders });

        if (body.status === 'rejected' && body.reason) {
          await env.DB.prepare(`UPDATE betting_submissions SET status = ?, reason = ? WHERE id = ?`).bind(body.status, body.reason, id).run();
        } else {
          await env.DB.prepare(`UPDATE betting_submissions SET status = ?, reason = NULL WHERE id = ?`).bind(body.status, id).run();
        }
        return Response.json({ success: true, message: `Status updated to ${body.status}` }, { headers: corsHeaders });
      }

      /* 3. ADMIN API: DELETE */
      const deleteMatch = path.match(/^\/api\/admin\/submissions\/(?<id>[^/]+)$/);
      if (deleteMatch && method === 'DELETE') {
        const id = deleteMatch.groups?.id;
        await env.DB.prepare(`DELETE FROM betting_submissions WHERE id = ?`).bind(id).run();
        return Response.json({ success: true, message: 'Deleted successfully' }, { headers: corsHeaders });
      }

      /* 4. CUSTOMER API: POST New Submission */
      if (path === '/api/submissions' && method === 'POST') {
        const body = await request.json<any>();
        if (!body.id || !body.user_id || !body.customer_name || !body.betting_type || !body.betting_data || body.total_amount === undefined || !body.session || !body.bet_date) {
          return new Response('Missing required fields', { status: 400, headers: corsHeaders });
        }

        await env.DB.prepare(
          `INSERT INTO betting_submissions (id, user_id, customer_name, betting_type, betting_data, total_amount, session, bet_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
        ).bind(body.id, body.user_id, body.customer_name, body.betting_type, JSON.stringify(body.betting_data), body.total_amount, body.session, body.bet_date).run();

        return Response.json({ success: true, message: 'Submission successful' }, { status: 201, headers: corsHeaders });
      }

      /* 5. CUSTOMER API: GET My Bets */
      if (path === '/api/submissions/my-bets' && method === 'GET') {
        const user_id = url.searchParams.get('user_id');
        if (!user_id) return new Response('Missing user_id', { status: 400, headers: corsHeaders });

        const { results } = await env.DB.prepare(`SELECT * FROM betting_submissions WHERE user_id = ? ORDER BY created_at DESC`).bind(user_id).all();
        const formattedResults = results.map((row: any) => ({ ...row, betting_data: typeof row.betting_data === 'string' ? JSON.parse(row.betting_data) : row.betting_data }));
        return Response.json(formattedResults, { headers: corsHeaders });
      }

      /* 6. CUSTOMER API: PUT Resubmit Rejected Bet (အသစ်ထည့်ထားသော လမ်းကြောင်း) */
      const updateMatch = path.match(/^\/api\/submissions\/(?<id>[^/]+)$/);
      if (updateMatch && method === 'PUT') {
        const id = updateMatch.groups?.id;
        const body = await request.json<any>();

        if (!body.user_id || !body.betting_type || !body.betting_data || body.total_amount === undefined || !body.session) {
          return new Response('Missing required fields', { status: 400, headers: corsHeaders });
        }

        // Customer က ပြင်ဆင်ပြီး ပြန်ပို့တဲ့အခါ Pending အဖြစ် ပြန်ထားပြီး Reason ကို ဖျက်ပေးမည်
        await env.DB.prepare(
          `UPDATE betting_submissions SET betting_type = ?, betting_data = ?, total_amount = ?, session = ?, status = 'pending', reason = NULL WHERE id = ? AND user_id = ?`
        ).bind(body.betting_type, JSON.stringify(body.betting_data), body.total_amount, body.session, id, body.user_id).run();

        return Response.json({ success: true, message: 'Updated successfully' }, { headers: corsHeaders });
      }

      return new Response('Not found', { status: 404, headers: corsHeaders });

    } catch (error: any) {
      console.error('API Error:', error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  },
};
