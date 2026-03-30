import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsResponse } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { moderateImage } from "../_shared/moderate.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const rateLimited = await checkRateLimit(
      supabaseAdmin,
      user.id,
      "upload-chat-media",
    );
    if (rateLimited) return rateLimited;

    const { league_id, team_id, image_base64 } = await req.json();
    if (!league_id || !team_id || !image_base64) {
      throw new Error("league_id, team_id, and image_base64 required");
    }

    // Verify the user owns this team
    const { data: team } = await supabaseAdmin
      .from("teams")
      .select("id, user_id")
      .eq("id", team_id)
      .single();
    if (!team || team.user_id !== user.id) throw new Error("Not your team");

    // Strip data URI prefix if present
    const raw = image_base64.replace(/^data:image\/\w+;base64,/, "");

    // ~3.75 MB decoded limit (5 MB base64 string)
    if (raw.length > 5_000_000) {
      return new Response(
        JSON.stringify({ error: "Image too large. Max size is ~3.75 MB." }),
        { status: 413, headers: { "Content-Type": "application/json" } },
      );
    }

    // Moderate with Cloud Vision
    const modResult = await moderateImage(raw);
    if (!modResult.safe) {
      return new Response(
        JSON.stringify({
          error: modResult.reason ?? "Image rejected by moderation",
        }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      );
    }

    // Decode base64 to binary
    const binaryStr = atob(raw);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    // Upload to chat-media bucket with unique filename
    const filePath = `${league_id}/${crypto.randomUUID()}.jpg`;
    const { error: uploadErr } = await supabaseAdmin.storage
      .from("chat-media")
      .upload(filePath, bytes, {
        contentType: "image/jpeg",
        upsert: false,
      });
    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

    const { data: urlData } = supabaseAdmin.storage
      .from("chat-media")
      .getPublicUrl(filePath);

    return new Response(
      JSON.stringify({ media_url: urlData.publicUrl }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("upload-chat-media error:", err);
    const status = err.message === "Unauthorized" ? 401 : 500;
    return new Response(
      JSON.stringify({ error: err.message }),
      { status, headers: { "Content-Type": "application/json" } },
    );
  }
});
