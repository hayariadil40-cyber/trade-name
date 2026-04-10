const fs = require('fs');

const indexHTML = fs.readFileSync('index.html', 'utf8');
let giornataHTML = fs.readFileSync('dettaglio_giornata.html', 'utf8');

// The start is: <div id="modal-analisi-alert"
const startModals = indexHTML.indexOf('<div id="modal-analisi-alert"');
// The end is before </main>
const endModals = indexHTML.indexOf('</main>', startModals);

if(startModals !== -1 && endModals !== -1) {
    let modalsCode = indexHTML.substring(startModals, endModals);
    
    // Check if css for modals is already there
    const cssStart = indexHTML.indexOf('<style>\n        /* CSS per gestire l\'apertura del modale da inline javascript */');
    const cssEnd = indexHTML.indexOf('</style>', cssStart);
    if(cssStart !== -1 && cssEnd !== -1) {
        modalsCode += '\n' + indexHTML.substring(cssStart, cssEnd + 8);
    }
    
    // Inject at the end of body in dettaglio_giornata.html
    const injectionPoint = giornataHTML.lastIndexOf('<script src="app.js">');
    if(injectionPoint !== -1) {
        giornataHTML = giornataHTML.slice(0, injectionPoint) + '\n\n' + modalsCode + '\n\n    ' + giornataHTML.slice(injectionPoint);
        fs.writeFileSync('dettaglio_giornata.html', giornataHTML, 'utf8');
        console.log('Modals injected successfully.');
    }
} else {
    console.log('Failed to find boundaries in index.html');
}
