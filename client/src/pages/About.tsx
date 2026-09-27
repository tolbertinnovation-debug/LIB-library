import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks';

export default function About() {
  useDocumentTitle('How borrowing works');
  return (
    <div className="container prose-page">
      <p className="eyebrow">About the library</p>
      <h1>How Liberia Online Library works</h1>
      <p className="lede">
        We are a public library that lives on the internet. Anyone can search the catalog and read our online collection; a free library card
        lets you borrow print books, join waitlists and keep your reading life in one place.
      </p>

      <h2>Two ways to read</h2>
      <div className="two-col">
        <div className="panel">
          <h3>Read online — free, instantly</h3>
          <p>
            Hundreds of classics whose copyright has expired open straight away in our reader. There’s no waitlist and no due date. Your place,
            bookmarks and notes are saved automatically when you’re signed in.
          </p>
          <Link to="/browse?readable=1">Browse the online collection →</Link>
        </div>
        <div className="panel">
          <h3>Borrow a print copy</h3>
          <p>
            Newer books live on our physical shelves. Each title has a set number of copies; when they’re all out, place a hold and we’ll save
            the next copy for you.
          </p>
          <Link to="/browse?available=1">See what’s on the shelf →</Link>
        </div>
      </div>

      <h2>Lending rules</h2>
      <ul className="rules">
        <li>
          <strong>14-day loans.</strong> Up to five books at a time.
        </li>
        <li>
          <strong>Two renewals</strong> of 14 days each — unless another member is waiting.
        </li>
        <li>
          <strong>Holds.</strong> Up to five at a time. When your copy comes in you have three days to collect it before it goes to the next
          person.
        </li>
        <li>
          <strong>Fine-free.</strong> We never charge late fees. We’d just like the book back so a neighbour can read it too.
        </li>
      </ul>

      <h2 id="public-domain">About our online texts</h2>
      <p>
        Our online books come from <a href="https://www.gutenberg.org/">Project Gutenberg</a>, the volunteer library of public-domain
        e-books. A handful are bundled with the library so they always open, even offline; others are fetched from Project Gutenberg the first
        time someone opens them. Shakespeare’s plays are presented in their original First Folio spelling. The Discover page can search tens of
        thousands more.
      </p>

      <h2>Can’t find a book?</h2>
      <p>
        Search the millions of records in <Link to="/discover">Discover</Link> and press “Suggest for our shelves”. Our librarians read every
        suggestion.
      </p>
    </div>
  );
}
