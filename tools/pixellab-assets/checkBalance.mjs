#!/usr/bin/env node
// 실행 전/후로 잔액을 확인하기 위한 최소 스크립트. 이 호출 자체는 과금되지 않습니다.
import "dotenv/config";
import { PixelLabClient, AuthenticationError } from "@pixellab-code/pixellab";

async function main() {
  let client;
  try {
    client = PixelLabClient.fromEnv();
  } catch (err) {
    console.error("PIXELLAB_SECRET(.env) 이 설정되어 있지 않습니다. .env.example 을 .env 로 복사한 뒤 키를 채워주세요.");
    process.exit(1);
  }
  try {
    const balance = await client.getBalance();
    console.log(`PixelLab 잔액: $${balance.usd.toFixed(4)} USD`);
  } catch (err) {
    if (err instanceof AuthenticationError) {
      console.error("인증 실패: API 키를 확인하세요.");
    } else {
      console.error(`잔액 조회 실패: ${err.message || err}`);
    }
    process.exit(1);
  }
}

main();
