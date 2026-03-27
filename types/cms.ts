/* ──────────────────────────────────────────────
 *  CMS content types
 *  Typed props for each CMS card/template component.
 *  These are framework-agnostic — they don't depend on
 *  Contentful, so the cards work with any data source.
 * ────────────────────────────────────────────── */

// ── Contentful Rich Text (lightweight subset) ──────────

export interface RichTextDocument {
  nodeType: 'document';
  content: RichTextNode[];
}

export interface RichTextTextNode {
  nodeType: 'text';
  value: string;
  marks: { type: string }[];
}

export interface RichTextAssetNode {
  nodeType: 'embedded-asset-block';
  data: {
    target: {
      fields: {
        title?: string;
        description?: string;
        file: { url: string; details?: { image?: { width: number; height: number } } };
      };
    };
  };
  content: [];
}

export interface RichTextHyperlinkNode {
  nodeType: 'hyperlink';
  data: { uri: string };
  content: RichTextNode[];
}

export interface RichTextBlockNode {
  nodeType:
    | 'paragraph'
    | 'heading-1'
    | 'heading-2'
    | 'heading-3'
    | 'heading-4'
    | 'heading-5'
    | 'heading-6'
    | 'unordered-list'
    | 'ordered-list'
    | 'list-item'
    | 'hr'
    | 'blockquote';
  content: RichTextNode[];
}

export type RichTextNode =
  | RichTextTextNode
  | RichTextAssetNode
  | RichTextHyperlinkNode
  | RichTextBlockNode;

// ── Card prop types ────────────────────────────

export interface ArticleCardProps {
  title: string;
  heroImageUrl?: string;
  bodyExcerpt: string;
  bodyDocument?: RichTextDocument;
  videoUrl?: string;
  author?: string;
  category?: string;
  publishedDate?: string; // ISO string
  onPress?: () => void;
}

export interface AnnouncementBannerProps {
  title: string;
  bodyExcerpt: string;
  bodyDocument?: RichTextDocument;
  severity: 'info' | 'warning' | 'urgent';
  pinned?: boolean;
  onPress?: () => void;
}

export interface SpotlightCardProps {
  title: string;
  playerName: string;
  headshotUrl?: string;
  bodyExcerpt: string;
  bodyDocument?: RichTextDocument;
  statCallout?: string; // e.g. "28.3 PPG"
  onPress?: () => void;
}

export interface TipCardProps {
  title: string;
  body: string; // short plain text
  category?: string;
  iconName?: string; // Ionicons name
  onPress?: () => void;
}

export interface PollCardProps {
  question: string;
  options: string[];
  expiryDate?: string; // ISO string
  onVote?: (index: number) => void;
}

// ── Mapped entry wrapper (used by the dispatcher) ──────

export type CmsMappedEntry =
  | { type: 'article'; props: ArticleCardProps }
  | { type: 'announcement'; props: AnnouncementBannerProps }
  | { type: 'playerSpotlight'; props: SpotlightCardProps }
  | { type: 'quickTip'; props: TipCardProps }
  | { type: 'poll'; props: PollCardProps }
  | { type: 'unknown'; props: null };
