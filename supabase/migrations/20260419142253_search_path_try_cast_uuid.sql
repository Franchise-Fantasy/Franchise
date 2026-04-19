-- try_cast_uuid has no table references, so '' is safe (and stricter).
ALTER FUNCTION public.try_cast_uuid(text) SET search_path = '';
