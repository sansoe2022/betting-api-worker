export interface Env {
  DB: D1Database;
}

// CORS headers များကို သတ်မှတ်ခြင်း (Frontend မှ လှမ်းခေါ်နိုင်ရန်)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Handle CORS preflight requests
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      /* ========================================================
         1. ADMIN API: Pending နှင့် Approved စာရင်းများကို ဆွဲယူခြင်း
         GET /api/admin/submissions?date=YYYY-MM-DD&session=morning
      ======================================================== */
      if (path === '/api/admin/submissions' && method === 'GET') {
        const date = url.searchParams.get('date');
        const session = url.searchParams.get('session');

        if (!date || !session) {
          return new Response('Missing date or session', { status: 400, headers: corsHeaders });
        }

        const { results } = await env.DB.prepare(
          `SELECT * FROM betting_submissions WHERE bet_date = ? AND session = ? ORDER BY created_at DESC`
        ).bind(date, session).all();

        return Response.json(results, { headers: corsHeaders });
      }

      /* ========================================================
         2. ADMIN API: Customer ၏ စာရင်းကို အတည်ပြု/ပယ်ချ လုပ်ခြင်း (Reason အပါအဝင်)
         PATCH /api/admin/submissions/:id/status
      ======================================================== */
      const statusMatch = path.match(/^\/api\/admin\/submissions\/(?<id>[^/]+)\/status$/);
      if (statusMatch && method === 'PATCH') {
        const id = statusMatch.groups?.id;
        const body: { status: string; reason?: string } = await request.json();

        if (!['approved', 'rejected', 'pending'].includes(body.status)) {
          return new Response('Invalid status', { status: 400, headers: corsHeaders });
        }

        // Reject ဖြစ်ပြီး အကြောင်းပြချက်ပါလာပါက reason ကိုပါ သိမ်းမည်၊ သို့မဟုတ်ပါက reason ကို NULL လုပ်မည်
        if (body.status === 'rejected' && body.reason) {
          await env.DB.prepare(
            `UPDATE betting_submissions SET status = ?, reason = ? WHERE id = ?`
          ).bind(body.status, body.reason, id).run();
        } else {
          await env.DB.prepare(
            `UPDATE betting_submissions SET status = ?, reason = NULL WHERE id = ?`
          ).bind(body.status, id).run();
        }

        return Response.json({ success: true, message: `Status updated to ${body.status}` }, { headers: corsHeaders });
      }

      /* ========================================================
         3. ADMIN API: Customer စာရင်းကို အပြီးတိုင် ဖျက်ပစ်ခြင်း
         DELETE /api/admin/submissions/:id
      ======================================================== */
      const deleteMatch = path.match(/^\/api\/admin\/submissions\/(?<id>[^/]+)$/);
      if (deleteMatch && method === 'DELETE') {
        const id = deleteMatch.groups?.id;

        await env.DB.prepare(
          `DELETE FROM betting_submissions WHERE id = ?`
        ).bind(id).run();

        return Response.json({ success: true, message: 'Deleted successfully' }, { headers: corsHeaders });
      }

      /* ========================================================
         4. CUSTOMER API: Customer ကိုယ်တိုင် စာရင်းသွင်းခြင်း
         POST /api/submissions
      ======================================================== */
      if (path === '/api/submissions' && method === 'POST') {
        const body = await request.json<any>();
        
        // Data အစုံအလင် ပါ/မပါ စစ်ဆေးခြင်း
        if (!body.id || !body.user_id || !body.customer_name || !body.betting_type || !body.betting_data || body.total_amount === undefined || !body.session || !body.bet_date) {
          return new Response('Missing required fields', { status: 400, headers: corsHeaders });
        }

        // အသစ်ထည့်သည့်အခါ status ကို 'pending' ပေးပြီး reason ကို အလွတ်ထားမည်
        await env.DB.prepare(
          `INSERT INTO betting_submissions (id, user_id, customer_name, betting_type, betting_data, total_amount, session, bet_date, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
        ).bind(
          body.id,
          body.user_id,
          body.customer_name,
          body.betting_type,
          JSON.stringify(body.betting_data), 
          body.total_amount,
          body.session,
          body.bet_date
        ).run();

        return Response.json({ success: true, message: 'Submission successful' }, { status: 201, headers: corsHeaders });
      }

      /* ========================================================
         5. CUSTOMER API: Customer ၏ ကိုယ်ပိုင် မှတ်တမ်းများ ပြန်ကြည့်ခြင်း
         GET /api/submissions/my-bets?user_id=xyz
      ======================================================== */
      if (path === '/api/submissions/my-bets' && method === 'GET') {
        const user_id = url.searchParams.get('user_id');

        if (!user_id) {
          return new Response('Missing user_id', { status: 400, headers: corsHeaders });
        }

        const { results } = await env.DB.prepare(
          `SELECT * FROM betting_submissions WHERE user_id = ? ORDER BY created_at DESC`
        ).bind(user_id).all();

        // String အဖြစ် သိမ်းထားသော betting_data ကို JSON Array အဖြစ် ပြန်ပြောင်းပေးခြင်း
        const formattedResults = results.map((row: any) => ({
          ...row,
          betting_data: typeof row.betting_data === 'string' ? JSON.parse(row.betting_data) : row.betting_data
        }));

        return Response.json(formattedResults, { headers: corsHeaders });
      }

      // လမ်းကြောင်း မှားယွင်းနေပါက (404 Not Found)
      return new Response('Not found', { status: 404, headers: corsHeaders });

    } catch (error: any) {
      console.error('API Error:', error);
      return new Response(JSON.stringify({ error: error.message }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
  },
};
