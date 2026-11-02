import { redirect } from "next/navigation";

// The queue is the admin's home for now (the only section that exists).
export default function Home() {
  redirect("/queue");
}
