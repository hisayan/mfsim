import MfViewer from "../components/MfViewer";
import type { Props } from "./index.server";
import "./style.css";

export default function SimPage({ areas, defaultAreaId }: Props) {
  return (
    <main className="sim">
      <header className="sim-header">
        <h1>mfsim</h1>
        <p>PLATEAU 3D都市モデル上の moving features シミュレータ（navara）</p>
      </header>
      <MfViewer areas={areas} defaultAreaId={defaultAreaId} />
    </main>
  );
}
