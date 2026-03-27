import { createClient } from "contentful";

const spaceId = process.env.EXPO_PUBLIC_CONTENTFUL_SPACE_ID || "";
const accessToken = process.env.EXPO_PUBLIC_CONTENTFUL_ACCESS_TOKEN || "";

export const contentful = createClient({
  space: spaceId,
  accessToken,
});
