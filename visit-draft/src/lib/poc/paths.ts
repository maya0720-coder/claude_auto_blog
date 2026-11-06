import path from "node:path";
import { PROJECT_ROOT } from "../config/load";

/** 프로젝트 폴더 기준 상대 경로(보고서·화면 표시용). 구분자는 /로 통일한다. */
export const toProjectPath = (abs: string) => path.relative(PROJECT_ROOT, abs).split(path.sep).join("/");
