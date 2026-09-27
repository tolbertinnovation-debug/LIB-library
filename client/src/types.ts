export interface Book {
  id: number;
  slug: string;
  title: string;
  author: string;
  year: number | null;
  language: string;
  description: string;
  subjects: string[];
  copies: number;
  available: number;
  onLoan: number;
  holdsWaiting: number;
  gutenbergId: number | null;
  verse: boolean;
  hasText: boolean;
  readable: boolean;
  wordCount: number;
  readingMinutes: number;
  featured: boolean;
  rating: number | null;
  ratingCount: number;
  timesBorrowed: number;
  createdAt: string;
}

export interface User {
  id: number;
  email: string;
  name: string;
  role: 'member' | 'librarian';
  cardNumber: string;
  readingGoal: number;
  createdAt: string;
}

export interface Circulation {
  copies: number;
  available: number;
  onLoan: number;
  waiting: number;
  loan: { id: number; borrowedAt: string; dueAt: string; renewals: number } | null;
  hold: { id: number; status: 'waiting' | 'ready'; position: number | null; createdAt: string; expiresAt: string | null } | null;
}

export interface Review {
  id: number;
  rating: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  reviewer: string;
  mine: boolean;
}

export type ShelfStatus = 'want' | 'reading' | 'finished';

export interface Shelf {
  status: ShelfStatus | null;
  favorite: boolean;
  finishedAt: string | null;
}

export interface Progress {
  sectionIdx: number;
  position?: number;
  percent: number;
  updatedAt?: string;
}

export interface TocEntry {
  idx: number;
  title: string;
  words: number;
}

export interface BookDetail {
  book: Book;
  circulation: Circulation;
  shelf: Shelf | null;
  progress: Progress | null;
  reviews: Review[];
  distribution: number[];
  toc: TocEntry[];
  similar: Book[];
  collections: { slug: string; title: string }[];
}

export interface Collection {
  slug: string;
  title: string;
  description: string;
  books: Book[];
}

export interface HomeData {
  featured: Book[];
  collections: Collection[];
  popular: Book[];
  added: Book[];
  bookOfTheDay: { book: Book; excerpt: string } | null;
  stats: { books: number; readable: number; copies: number; words: number; members: number; loans: number };
  continueReading: (Book & { progress: Progress })[];
}

export interface SearchResult {
  total: number;
  page: number;
  pages: number;
  books: Book[];
}

export interface Loan {
  id: number;
  borrowedAt: string;
  dueAt: string;
  returnedAt: string | null;
  renewals: number;
  renewalsLeft: number;
  othersWaiting: number;
  book: Book;
}

export interface Hold {
  id: number;
  status: 'waiting' | 'ready';
  createdAt: string;
  readyAt: string | null;
  expiresAt: string | null;
  position: number | null;
  book: Book;
}

export interface Bookmark {
  id: number;
  bookId: number;
  sectionIdx: number;
  sectionTitle: string | null;
  position: number;
  excerpt: string;
  note: string;
  createdAt: string;
  book?: { slug: string; title: string; author: string };
}

export interface Stats {
  year: number;
  goal: number;
  finishedThisYear: number;
  finishedAllTime: number;
  streak: number;
  totalMinutes: number;
  wordsRead: number;
  totalBorrowed: number;
  activity: { day: string; minutes: number }[];
  topSubjects: { name: string; count: number }[];
}

export interface Suggestion {
  id: number;
  title: string;
  author: string;
  note: string;
  status: 'open' | 'acquired' | 'declined';
  createdAt: string;
  member?: string;
  sourceKey?: string | null;
}

export interface Dashboard {
  user: User;
  rules: { loanDays: number; maxLoans: number; maxRenewals: number; maxHolds: number; holdReadyDays: number };
  loans: Loan[];
  history: Loan[];
  holds: Hold[];
  shelves: { status: ShelfStatus | null; favorite: boolean; finishedAt: string | null; progress: Progress | null; book: Book }[];
  bookmarks: Bookmark[];
  suggestions: Suggestion[];
  stats: Stats;
  recommendations: Book[];
}

export interface Section {
  idx: number;
  title: string;
  body: string;
  words: number;
  count: number;
}
