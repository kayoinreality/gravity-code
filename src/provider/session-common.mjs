export async function bootstrapGemini(session, fetcher = globalThis.fetch) {
 const response=await fetcher('https://gemini.google.com/app',{
  headers:{Cookie:session.cookieHeader('https://gemini.google.com/app'),'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'},
  redirect:'manual',signal:AbortSignal.timeout(30000),
 });
 if(response.status!==200)throw new Error(`A sessão Google retornou HTTP ${response.status}. Entre novamente no Gemini.`);
 const html=await response.text();
 const field=(name)=>{const match=html.match(new RegExp(`"${name}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`));return match?JSON.parse(match[1]):undefined;};
 const csrf=field('SNlM0e');
 if(!csrf){const error=new Error('Conecte sua conta Google no Gravity Code para usar o Gemini.');error.code='GRAVITY_AUTH_REQUIRED';throw error;}
 return {csrf,buildLabel:field('cfb2h'),sessionId:field('FdrFJe')};
}
