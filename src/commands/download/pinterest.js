module.exports = {
    name: "pinterest",
    alias: ['pinterestdl'],
    usage: '<Query>',
    type: 'download',
    desc: 'Downloads a song based on the given lyrics or name.',
    start: async (sock, m, { text }) => {
        await pinterest(sock, m, text);

    }
}

async function pinterest(url) {
    try {
        const response = await fetch(`https://www.savepin.app/download.php?url=${url}&lang=en&type=redirect`)
        const body = await response.text()
        const $ = cheerio.load(body)
        const results = []

        // Cari tabel media
        const imageTable = $('table').has('tr:contains("Quality")').first()
        const videoTable = $('table').has('tr:contains("480p")').first()

        // Fungsi untuk mendekode media link
        const decodeMediaLink = (link) => {
            if (!link) return null
            return decodeURIComponent(link.replace('https://www.savepin.appforce-save.php?url=', ''))
        }

        if (imageTable.length) {
            imageTable.find('tr').each((_, element) => {
                const quality = $(element).find('.video-quality').text()
                const format = $(element).find('td:nth-child(2)').text()
                const downloadLink = $(element).find('a').attr('href')
                if (quality) {
                    results.push({
                        quality,
                        format,
                        media: decodeMediaLink('https://www.savepin.app' + downloadLink),
                    })
                }
            })
        } else if (videoTable.length) {
            videoTable.find('tr').each((_, element) => {
                const quality = $(element).find('.video-quality').text()
                const format = $(element).find('td:nth-child(2)').text()
                const downloadLink = $(element).find('a').attr('href')
                if (quality) {
                    results.push({
                        quality,
                        format,
                        media: decodeMediaLink(downloadLink),
                    })
                }
            })
        } else {
            return { message: 'Tidak ada tabel media ditemukan.' }
        }

        return { results }
    } catch (error) {
        return { error: 'Error fetching media data: ' + error.message }
    }
}