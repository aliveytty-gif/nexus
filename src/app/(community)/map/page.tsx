import { CollegeMap } from "@/features/map/college-map";
import { collegeMap } from "@/features/map/data";
import { requireUser } from "@/lib/auth/session";
export const metadata = { title: "Карта колледжа" };
export default async function MapPage() {
  await requireUser("/map");
  return <CollegeMap map={collegeMap} />;
}
