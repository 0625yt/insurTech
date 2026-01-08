/**
 * n8n Credentials 자동 설정 스크립트
 *
 * 사용법:
 * 1. n8n이 실행 중인지 확인 (http://localhost:5678)
 * 2. node setup-credentials.js 실행
 */

const http = require('http');

const N8N_HOST = process.env.N8N_HOST || 'localhost';
const N8N_PORT = process.env.N8N_PORT || 5678;

// 설정할 Credentials 목록
const credentials = [
  {
    name: 'InsurTech DB',
    type: 'postgres',
    data: {
      host: 'localhost',
      database: 'insurtech',
      user: 'insurtech_user',
      password: 'insurtech_password_2024',
      port: 5432,
      ssl: 'disable'
    }
  },
  {
    name: 'InsurTech Redis',
    type: 'redis',
    data: {
      host: 'localhost',
      port: 6379,
      password: ''
    }
  },
  {
    name: 'OpenAI API',
    type: 'openAiApi',
    data: {
      apiKey: process.env.OPENAI_API_KEY || 'sk-your-api-key-here'
    }
  },
  {
    name: 'Anthropic API',
    type: 'httpHeaderAuth',
    data: {
      name: 'x-api-key',
      value: process.env.ANTHROPIC_API_KEY || 'sk-ant-your-api-key-here'
    }
  }
];

async function createCredential(credential) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      name: credential.name,
      type: credential.type,
      data: credential.data
    });

    const options = {
      hostname: N8N_HOST,
      port: N8N_PORT,
      path: '/api/v1/credentials',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          console.log(`✅ ${credential.name} 생성 완료`);
          resolve(JSON.parse(body));
        } else {
          console.log(`⚠️ ${credential.name}: ${body}`);
          resolve(null);
        }
      });
    });

    req.on('error', (e) => {
      console.log(`❌ ${credential.name} 오류: ${e.message}`);
      reject(e);
    });

    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('='.repeat(50));
  console.log('🔐 n8n Credentials 자동 설정');
  console.log('='.repeat(50));
  console.log('');

  for (const cred of credentials) {
    try {
      await createCredential(cred);
    } catch (e) {
      console.log(`건너뜀: ${cred.name}`);
    }
  }

  console.log('');
  console.log('='.repeat(50));
  console.log('완료! n8n에서 확인하세요: http://localhost:5678/credentials');
  console.log('='.repeat(50));
}

main().catch(console.error);
