const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const states = [
    { name: 'alabama', code: 'alabama' },
    { name: 'alaska', code: 'alaska' },
    { name: 'arizona', code: 'arizona' },
    { name: 'arkansas', code: 'arkansas' },
    { name: 'california', code: 'california' },
    { name: 'colorado', code: 'colorado' },
    { name: 'connecticut', code: 'connecticut' },
    { name: 'delaware', code: 'delaware' },
    { name: 'florida', code: 'florida' },
    { name: 'georgia', code: 'georgia' },
    { name: 'hawaii', code: 'hawaii' },
    { name: 'idaho', code: 'idaho' },
    { name: 'illinois', code: 'illinois' },
    { name: 'indiana', code: 'indiana' },
    { name: 'iowa', code: 'iowa' },
    { name: 'kansas', code: 'kansas' },
    { name: 'kentucky', code: 'kentucky' },
    { name: 'louisiana', code: 'louisiana' },
    { name: 'maine', code: 'maine' },
    { name: 'maryland', code: 'maryland' },
    { name: 'massachusetts', code: 'massachusetts' },
    { name: 'michigan', code: 'michigan' },
    { name: 'minnesota', code: 'minnesota' },
    { name: 'mississippi', code: 'mississippi' },
    { name: 'missouri', code: 'missouri' },
    { name: 'montana', code: 'montana' },
    { name: 'nebraska', code: 'nebraska' },
    { name: 'nevada', code: 'nevada' },
    { name: 'new-hampshire', code: 'new-hampshire' },
    { name: 'new-jersey', code: 'new-jersey' },
    { name: 'new-mexico', code: 'new-mexico' },
    { name: 'new-york', code: 'new-york' },
    { name: 'north-carolina', code: 'north-carolina' },
    { name: 'north-dakota', code: 'north-dakota' },
    { name: 'ohio', code: 'ohio' },
    { name: 'oklahoma', code: 'oklahoma' },
    { name: 'oregon', code: 'oregon' },
    { name: 'pennsylvania', code: 'pennsylvania' },
    { name: 'rhode-island', code: 'rhode-island' },
    { name: 'south-carolina', code: 'south-carolina' },
    { name: 'south-dakota', code: 'south-dakota' },
    { name: 'tennessee', code: 'tennessee' },
    { name: 'texas', code: 'texas' },
    { name: 'utah', code: 'utah' },
    { name: 'vermont', code: 'vermont' },
    { name: 'virginia', code: 'virginia' },
    { name: 'washington', code: 'washington' },
    { name: 'west-virginia', code: 'west-virginia' },
    { name: 'wisconsin', code: 'wisconsin' },
    { name: 'wyoming', code: 'wyoming' }
];

const DATA_DIR = './data';
const TEMP_DIR = './temp';

// Создаем директории если они не существуют
[DATA_DIR, TEMP_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
});

async function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
}

async function processState(state) {
    console.log(`\nОбработка штата ${state.name}...`);
    
    const pbfFile = path.join(TEMP_DIR, `${state.code}.osm.pbf`);
    const url = `https://download.geofabrik.de/north-america/us/${state.code}-latest.osm.pbf`;
    
    try {
        // Загрузка файла
        console.log(`Загрузка данных для ${state.name}...`);
        await downloadFile(url, pbfFile);
        
        // Обработка файла с помощью OSRM
        console.log(`Извлечение данных для ${state.name}...`);
        execSync(`docker run -t -v "${path.resolve(TEMP_DIR)}:/data" ghcr.io/project-osrm/osrm-backend osrm-extract -p /opt/car.lua /data/${state.code}.osm.pbf`, { stdio: 'inherit' });
        
        console.log(`Создание разделов для ${state.name}...`);
        execSync(`docker run -t -v "${path.resolve(TEMP_DIR)}:/data" ghcr.io/project-osrm/osrm-backend osrm-partition /data/${state.code}.osrm`, { stdio: 'inherit' });
        
        console.log(`Настройка данных для ${state.name}...`);
        execSync(`docker run -t -v "${path.resolve(TEMP_DIR)}:/data" ghcr.io/project-osrm/osrm-backend osrm-customize /data/${state.code}.osrm`, { stdio: 'inherit' });
        
        // Перемещение обработанных файлов
        const files = fs.readdirSync(TEMP_DIR);
        files.forEach(file => {
            if (file.startsWith(state.code)) {
                fs.renameSync(
                    path.join(TEMP_DIR, file),
                    path.join(DATA_DIR, file)
                );
            }
        });
        
        console.log(`${state.name} успешно обработан!`);
    } catch (error) {
        console.error(`Ошибка при обработке ${state.name}:`, error);
    }
}

async function processAllStates() {
    console.log('Начинаем загрузку и обработку данных всех штатов США...');
    
    for (const state of states) {
        await processState(state);
    }
    
    console.log('\nВсе штаты обработаны!');
    
    // Очистка временной директории
    fs.rmdirSync(TEMP_DIR, { recursive: true });
}

processAllStates().catch(console.error); 