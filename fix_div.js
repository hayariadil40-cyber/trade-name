const fs = require('fs');
let html = fs.readFileSync('dettaglio_sessione.html', 'utf8');

// The closing div is at the bottom of the Categorizzatore block.
// Let's find exactly lines ~311-318.
const buggy = `                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                    <!-- Monitoraggio Comportamentale (Live) -->`;

const fixed = `                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- Monitoraggio Comportamentale (Live) -->`;

html = html.replace(buggy, fixed);
fs.writeFileSync('dettaglio_sessione.html', html, 'utf8');
console.log('Fixed early closing div.');
