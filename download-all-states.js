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

// Конфигурация retry
const RETRY_CONFIG = {
    maxRetries: 3,
    initialDelay: 2000, // 2 секунды
    backoffMultiplier: 2,
    timeout: 300000 // 5 минут таймаут
};

// Создаем директории если они не существуют
[DATA_DIR, TEMP_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
});

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadFileWithRetry(url, dest, retryCount = 0) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        let isResolved = false;
        
        // Устанавливаем таймаут
        const timeout = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                file.destroy();
                fs.unlink(dest, () => {});
                reject(new Error('Timeout: загрузка превысила лимит времени'));
            }
        }, RETRY_CONFIG.timeout);

        const request = https.get(url, {
            timeout: 30000 // 30 секунд на соединение
        }, (response) => {
            if (response.statusCode === 200) {
                response.pipe(file);
                
                file.on('finish', () => {
                    if (!isResolved) {
                        isResolved = true;
                        file.close();
                        clearTimeout(timeout);
                        resolve();
                    }
                });
                
                file.on('error', (err) => {
                    if (!isResolved) {
                        isResolved = true;
                        clearTimeout(timeout);
                        fs.unlink(dest, () => {});
                        reject(err);
                    }
                });
            } else {
                isResolved = true;
                clearTimeout(timeout);
                file.destroy();
                fs.unlink(dest, () => {});
                reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
            }
        });

        request.on('error', (err) => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timeout);
                file.destroy();
                fs.unlink(dest, () => {});
                reject(err);
            }
        });

        request.on('timeout', () => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timeout);
                file.destroy();
                fs.unlink(dest, () => {});
                reject(new Error('Request timeout'));
            }
        });
    });
}

async function downloadFile(url, dest) {
    let lastError;
    
    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
        try {
            console.log(`Попытка загрузки ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}...`);
            await downloadFileWithRetry(url, dest);
            return; // Успешная загрузка
        } catch (error) {
            lastError = error;
            console.warn(`Ошибка загрузки (попытка ${attempt + 1}):`, error.message);
            
            if (attempt < RETRY_CONFIG.maxRetries) {
                const delay = RETRY_CONFIG.initialDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt);
                console.log(`Ожидание ${delay / 1000} секунд перед повторной попыткой...`);
                await sleep(delay);
            }
        }
    }
    
    throw new Error(`Не удалось загрузить файл после ${RETRY_CONFIG.maxRetries + 1} попыток. Последняя ошибка: ${lastError.message}`);
}

async function processState(state) {
    console.log(`\nОбработка штата ${state.name}...`);
    
    const pbfFile = path.join(TEMP_DIR, `${state.code}.osm.pbf`);
    const url = `https://download.geofabrik.de/north-america/us/${state.code}-latest.osm.pbf`;
    
    try {
        // Проверяем, не обработан ли уже этот штат
        const existingFiles = fs.readdirSync(DATA_DIR);
        const stateFiles = existingFiles.filter(file => file.startsWith(state.code));
        
        if (stateFiles.length > 0) {
            console.log(`${state.name} уже обработан, пропускаем...`);
            return;
        }

        // Загрузка файла с retry логикой
        console.log(`Загрузка данных для ${state.name}...`);
        await downloadFile(url, pbfFile);
        console.log(`✓ Загрузка ${state.name} завершена успешно`);
        
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
                const srcPath = path.join(TEMP_DIR, file);
                const destPath = path.join(DATA_DIR, file);
                
                try {
                    fs.renameSync(srcPath, destPath);
                } catch (renameError) {
                    // Если rename не работает, копируем и удаляем
                    fs.copyFileSync(srcPath, destPath);
                    fs.unlinkSync(srcPath);
                }
            }
        });
        
        console.log(`✓ ${state.name} успешно обработан!`);
        
        // Небольшая пауза между штатами
        await sleep(1000);
        
    } catch (error) {
        console.error(`❌ Ошибка при обработке ${state.name}:`, error.message);
        
        // Очищаем частично загруженные файлы
        try {
            if (fs.existsSync(pbfFile)) {
                fs.unlinkSync(pbfFile);
            }
        } catch (cleanupError) {
            console.warn(`Предупреждение: не удалось очистить файл ${pbfFile}`);
        }
    }
}

async function processAllStates() {
    console.log('Начинаем загрузку и обработку данных всех штатов США...');
    console.log(`Настройки retry: максимум ${RETRY_CONFIG.maxRetries} попыток, таймаут ${RETRY_CONFIG.timeout/1000} секунд`);
    
    let processed = 0;
    let failed = 0;
    
    for (const state of states) {
        try {
            await processState(state);
            processed++;
        } catch (error) {
            failed++;
            console.error(`Окончательная ошибка для ${state.name}:`, error.message);
        }
    }
    
    console.log(`\n📊 Итоги обработки:`);
    console.log(`✓ Успешно обработано: ${processed} штатов`);
    console.log(`❌ Ошибки: ${failed} штатов`);
    console.log(`📁 Всего штатов: ${states.length}`);
    
    // Очистка временной директории только при полном успехе
    if (failed === 0) {
        try {
            const tempFiles = fs.readdirSync(TEMP_DIR);
            tempFiles.forEach(file => {
                fs.unlinkSync(path.join(TEMP_DIR, file));
            });
            console.log('✓ Временные файлы очищены');
        } catch (cleanupError) {
            console.warn('Предупреждение: не удалось очистить временные файлы');
        }
    } else {
        console.log('⚠️  Временные файлы сохранены для повторной обработки неудачных загрузок');
    }
}

processAllStates().catch(console.error); 