import { App } from "../components/App";
import { serverContext } from "../lib/server/context";

export const dynamic = "force-dynamic";

/** 사진 제한값 등은 서버 설정(config/defaults.json)에서 읽어 화면에 넘긴다. 서버에서도 같은 값으로 다시 검사한다. */
export default function Home() {
  const { images, faces, jobs } = serverContext().cfg;
  return (
    <App
      limits={{ maxCount: images.jobMaxCount, maxBytes: images.maxBytes, extensions: images.allowedExtensions }}
      defaultFaceMode={faces.defaultMode}
      retentionDays={jobs.retentionDays}
    />
  );
}
