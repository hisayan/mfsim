import MfViewer from "../components/MfViewer";
import type { Props } from "./index.server";
import "./style.css";

export default function SimPage({ areas, defaultAreaId }: Props) {
  return (
    <main className="sim">
      <header className="sim-header">
        <h1>mfsim</h1>
        <p>Moving features simulator on PLATEAU 3D city models (navara)</p>
      </header>
      <MfViewer areas={areas} defaultAreaId={defaultAreaId} />
    </main>
  );
}
