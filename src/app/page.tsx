import { redirect } from "next/navigation";

// Middleware sends signed-out traffic to /login, so anyone reaching here has a
// session cookie and belongs on their day view.
export default function Home() {
  redirect("/my-day");
}
