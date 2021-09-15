const algorithmia = require('algorithmia');
const algorithmiaApiKey = require('../credentials/algorithmia.json').apiKey;
const sentenceBoundaryDetection = require('sbd');
const watsonCredentials = require('../credentials/watson-nlu.json');
const NaturalLanguageUnderstandingV1 = require('ibm-watson/natural-language-understanding/v1');
const { IamAuthenticator } = require('ibm-watson/auth');
const nlu = new NaturalLanguageUnderstandingV1({
    version: '2021-08-01',
    authenticator: new IamAuthenticator({
        apikey: watsonCredentials.apikey,
    }),
    serviceUrl: watsonCredentials.url,
});

const state = require('./state.js');

async function robot() {
    console.log('> [text-robot] Starting...');
    const content = state.load();

    await fetchContentFromWikipedia(content);
    sanitizeContent(content);
    breakContentIntoSentences(content);
    limitMaximumSentences(content);
    await fetchKeywordsOfAllSentences(content);

    state.save(content);

    async function fetchContentFromWikipedia(content) {
        console.log('> [text-robot] Fetching content from Wikipedia');
        const searchTerm = {
            articleName: content.searchTerm,
            lang: 'pt',
        };

        const algorithmiaAuthenticated = algorithmia(algorithmiaApiKey);
        const wikipediaAlgorithm = algorithmiaAuthenticated.algo('web/WikipediaParser/0.1.2?timeout=3000');
        const wikipediaResponse = await wikipediaAlgorithm.pipe(searchTerm);
        const wikipediaContent = wikipediaResponse.get();
        content.sourceContentOriginal = wikipediaContent.content;
        console.log('> [text-robot] Fetching done!');
    }

    function sanitizeContent(content) {
        const withoutBlankLinesAndMarkdown = removeBlankLinesAndMarkdown(content.sourceContentOriginal);

        const withoutDatesInParentheses = removeDatesInParentheses(withoutBlankLinesAndMarkdown);

        content.sourceContentSanitized = withoutDatesInParentheses;

        function removeBlankLinesAndMarkdown(text) {
            const allLines = text.split('\n');

            const withoutBlankLinesAndMarkdown = allLines.filter((line) => {
                if (line.trim().length === 0 || line.trim().startsWith('=')) {
                    return false;
                }

                return true;
            });

            return withoutBlankLinesAndMarkdown.join(' ');
        }
    }

    function removeDatesInParentheses(text) {
        return text.replace(/\((?:\([^()]*\)|[^()])*\)/gm, '').replace(/  /g, ' ');
    }

    function breakContentIntoSentences(content) {
        content.sentences = [];

        const sentences = sentenceBoundaryDetection.sentences(content.sourceContentSanitized);
        sentences.forEach((sentence) => {
            content.sentences.push({
                text: sentence,
                keywords: [],
                images: [],
            });
        });
    }

    function limitMaximumSentences(content) {
        content.sentences = content.sentences.slice(0, content.maximumSentences);
    }

    async function fetchKeywordsOfAllSentences(content) {
        console.log('> [text-robot] Starting to fetch keywords from Watson');

        for (const sentence of content.sentences) {
            console.log(`> [text-robot] Sentence: "${sentence.text}"`);

            sentence.keywords = await fetchWatsonAndReturnKeywords(sentence.text);

            //console.log(`> [text-robot] Keywords: ${sentence.keywords.join(', ')}\n`);
        }
    }

    function fetchWatsonAndReturnKeywords(sentence) {
        const analyzeParams = {
            text: sentence,
            language: 'pt',
            features: {
                keywords: {
                    emotion: true,
                    sentiment: true,
                    limit: 2,
                },
            },
        };

        return new Promise((resolve, reject) => {
            nlu
                .analyze(analyzeParams)
                .then((response) => {
                    const keywords = response.result.keywords.map((keyword) => {
                        return keyword.text;
                    });
                    resolve(keywords);
                })
                .catch((error) => {
                    reject(error);
                });
        });
    }
}

module.exports = robot;
