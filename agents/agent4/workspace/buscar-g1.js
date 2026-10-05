const { request } = require('undici');
const dns = require('dns');

dns.setServers(['8.8.8.8', '1.1.1.1']);

function main() {
  try {
    console.log('Resolvendo DNS...');
    dns.resolve4('g1.globo.com', (err, addr) => {
      if (err) {
        console.error('Erro DNS:', err.message);
        return;
      }
      console.log('IP:', addr);
      
      console.log('\nBaixando conteúdo do G1...');
      request('https://g1.globo.com/', { 
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      }, (err, response) => {
        if (err) {
          console.error('Erro na requisição:', err.message);
          return;
        }
        
        let data = '';
        response.body.on('data', chunk => {
          data += chunk.toString();
          if (data.length > 20000) {
            response.body.destroy();
          }
        });
        response.body.on('end', () => {
          console.log('\n=== CONTEÚDO DO G1 ===');
          console.log(data.substring(0, 15000));
        });
      });
    });
  } catch (err) {
    console.error('Erro:', err.message);
  }
}

main();
