/** Expected by hand from the demo script (src/demo.ts): chats newest first, with unread incoming messages. */
export const EXPECTED_CHATS = [
  { title: "Karel Holub", threads: ["D"], messages: 8, unread: 3 },
  { title: "Bob Svoboda", threads: ["I", "J", "K", "L"], messages: 10, unread: 1 },
  { title: "Ondřej Beneš", threads: ["H"], messages: 4, unread: 1 },
  { title: "Petr Novák", threads: ["G"], messages: 3, unread: 0 },
  { title: "Anna Becker", threads: ["B"], messages: 5, unread: 2 },
  { title: "Camille Lefèvre, Julien Moreau", threads: ["C"], messages: 4, unread: 0 },
  { title: "Bob Svoboda, Jana Nováková", threads: ["A"], messages: 5, unread: 1 },
];

/** "Other mail": the mailing list (with Alice's own post) and the newsletter. */
export const EXPECTED_OTHER = [
  { title: "dev-list@lists.example.org", kind: "list", threads: ["F"], messages: 5, unread: 2 },
  { title: "Garden Club", kind: "list", threads: ["E"], messages: 1, unread: 1 },
];

/** The subjects of the chat with Bob, oldest first, one per run of messages. */
export const BOB_SUBJECTS = ["Faktura za únor", "Víkend na chatě", "Návrh smlouvy", "Kolo na prodej"];
