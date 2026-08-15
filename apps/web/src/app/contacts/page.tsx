import type { Metadata } from "next";
import AddressBook from "@/components/AddressBook";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Address book",
  description: "Saved recipients, checked once and reused — no more pasting addresses.",
  // A private screen: keep it out of search results entirely.
  robots: { index: false, follow: false },
};

export default function ContactsPage() {
  return (
    <>
      <PageHeader title="Address book" />
      <AddressBook />
    </>
  );
}
