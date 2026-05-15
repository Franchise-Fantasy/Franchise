import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS, corsResponse } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { moderateImage } from "../_shared/moderate.ts";

const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SB_SECRET_KEY")!,
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SB_PUBLISHABLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'upload-team-logo');
    if (rateLimited) return rateLimited;

    const { team_id, image_base64 } = await req.json();
    if (!team_id || !image_base64) throw new Error("team_id and image_base64 required");

    const { data: team } = await supabaseAdmin
      .from("teams")
      .select("id, user_id")
      .eq("id", team_id)
      .single();
    if (!team || team.user_id !== user.id) throw new Error("Not your team");

    const raw = image_base64.replace(/^data:image\/\w+;base64,/, "");

    const modResult = await moderateImage(raw);
    if (!modResult.safe) {
      // Soft-fail with 200 so supabase-js doesn't throw; client reads data.error
      return new Response(
        JSON.stringify({ error: modResult.reason ?? "Image rejected by moderation" }),
        { status: 200, headers: JSON_HEADERS },
      );
    }

    const binaryStr = atob(raw);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const filePath = `${team_id}.jpg`;
    const { error: uploadErr } = await supabaseAdmin.storage
      .from("team-logos")
      .upload(filePath, bytes, {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

    const { data: urlData } = supabaseAdmin.storage
      .from("team-logos")
      .getPublicUrl(filePath);

    const logoUrl = `${urlData.publicUrl}?v=${Date.now()}`;

    const { error: updateErr } = await supabaseAdmin
      .from("teams")
      .update({ logo_key: logoUrl })
      .eq("id", team_id);
    if (updateErr) throw new Error(`Update failed: ${updateErr.message}`);

    return new Response(
      JSON.stringify({ logo_url: logoUrl }),
      { status: 200, headers: JSON_HEADERS },
    );
  } catch (err: any) {
    const message = err?.message ?? "Unknown error";
    console.error("upload-team-logo error:", message, err);
    const status = message === "Unauthorized" ? 401 : 500;
    return new Response(
      JSON.stringify({ error: message }),
      { status, headers: JSON_HEADERS },
    );
  }
});
