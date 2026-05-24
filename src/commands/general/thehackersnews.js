const axios = require('axios');
const cheerio = require('cheerio');

async function fetchNews() {
  const url = 'https://thehackernews.com/search/label/CyberAttack';

  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    const newsLinks = [];
    $('.post-title a').each((index, element) => {
        newsLinks.push($(element).attr('href'));
    });
      

    //console.log('Res:', response.data);
    //console.log('$', $ );
    //console.log(newsLinks);
    //console.log(newsLinks);
  } catch (error) {
    console.error(`Error fetching news: ${error.message}`);
  }
}

fetchNews();