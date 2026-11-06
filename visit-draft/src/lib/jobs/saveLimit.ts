/** 하루 임시저장 횟수 제한(설계서 11.3). 자동화 남용으로 계정이 제재되는 위험을 줄인다. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveDataPath } from "../config/load";
import type { Defaults } from "../config/schema";

interface Counter {
  date: string;
  count: number;
}

/** 이 PC의 날짜(YYYY-MM-DD) */
export const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export class SaveLimit {
  private readonly file: string;

  constructor(private readonly cfg: Defaults["save"]) {
    this.file = resolveDataPath(cfg.countFile);
  }

  private read(today: string): Counter {
    try {
      if (existsSync(this.file)) {
        const c = JSON.parse(readFileSync(this.file, "utf8")) as Counter;
        if (c.date === today && Number.isInteger(c.count) && c.count >= 0) return c;
      }
    } catch {
      // 파일이 깨졌으면 오늘 0회로 본다
    }
    return { date: today, count: 0 };
  }

  remaining(now = new Date()): number {
    return Math.max(0, this.cfg.dailyLimit - this.read(localDate(now)).count);
  }

  /** 저장을 시도할 때 1회 센다. 한도를 넘으면 false */
  take(now = new Date()): boolean {
    const today = localDate(now);
    const c = this.read(today);
    if (c.count >= this.cfg.dailyLimit) return false;
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ date: today, count: c.count + 1 }), "utf8");
    return true;
  }
}
