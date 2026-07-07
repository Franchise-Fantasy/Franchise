import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { HttpError, handleError, jsonResponse, errorResponse } from "../_shared/http.ts";
import { moderateImage } from "../_shared/moderate.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { parseBody, z } from "../_shared/validate.ts";

const Body = z.object({
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

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'upload-team-logo');
    if (rateLimited) return rateLimited;

    const { team_id, image_base64 } = parseBody(Body, await req.json());

    const { data: team } = await supabaseAdmin
      .from("teams")
      .select("id, user_id")
      .eq("id", team_id)
      .single();
    if (!team || team.user_id !== user.id) throw new HttpError("Not your team", 403);

    const raw = image_base64.replace(/^data:image\/\w+;base64,/, "");

    const modResult = await moderateImage(raw);
    if (!modResult.safe) {
      // Soft-fail with 200 so supabase-js doesn't throw; client reads data.error
      return errorResponse(modResult.reason ?? "Image rejected by moderation", 200);
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
    if (uploadErr) throw uploadErr;

    const { data: urlData } = supabaseAdmin.storage
      .from("team-logos")
      .getPublicUrl(filePath);

    const logoUrl = `${urlData.publicUrl}?v=${Date.now()}`;

    const { error: updateErr } = await supabaseAdmin
      .from("teams")
      .update({ logo_key: logoUrl })
      .eq("id", team_id);
    if (updateErr) throw updateErr;

    return jsonResponse({ logo_url: logoUrl });
  } catch (error) {
    return handleError(error, 'upload-team-logo');
  }
});
