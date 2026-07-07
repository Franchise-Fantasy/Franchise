import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { HttpError, handleError, jsonResponse, errorResponse } from "../_shared/http.ts";
import { moderateImage } from "../_shared/moderate.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { parseBody, z } from "../_shared/validate.ts";

const Body = z.object({
  league_id: z.string().uuid('league_id must be a valid UUID'),
  team_id: z.string().uuid('team_id must be a valid UUID'),
  image_base64: z.string().min(1, 'image_base64 is required'),
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SB_SECRET_KEY")!,
    );
    const user = await requireUser(req);

    const rateLimited = await checkRateLimit(
      supabaseAdmin,
      user.id,
      "upload-chat-media",
    );
    if (rateLimited) return rateLimited;

    const { league_id, team_id, image_base64 } = parseBody(Body, await req.json());

    // Verify the user owns this team and it belongs to the target league
    const { data: team } = await supabaseAdmin
      .from("teams")
      .select("id, user_id")
      .eq("id", team_id)
      .eq("league_id", league_id)
      .single();
    if (!team || team.user_id !== user.id) throw new HttpError("Not your team", 403);

    // Strip data URI prefix if present
    const raw = image_base64.replace(/^data:image\/\w+;base64,/, "");

    // ~3.75 MB decoded limit (5 MB base64 string)
    if (raw.length > 5_000_000) {
      return errorResponse("Image too large. Max size is ~3.75 MB.", 413);
    }

    // Moderate with Cloud Vision
    const modResult = await moderateImage(raw);
    if (!modResult.safe) {
      return errorResponse(modResult.reason ?? "Image rejected by moderation", 422);
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
    if (uploadErr) throw uploadErr;

    const { data: urlData } = supabaseAdmin.storage
      .from("chat-media")
      .getPublicUrl(filePath);

    return jsonResponse({ media_url: urlData.publicUrl });
  } catch (error) {
    return handleError(error, 'upload-chat-media');
  }
});
