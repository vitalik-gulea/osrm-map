const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Список штатов для загрузки
const specificStates = [
    { name: 'delaware', code: 'delaware' },
    { name: 'colorado', code: 'colorado' },
    { name: 'california', code: 'california' },
    { name: 'arkansas', code: 'arkansas' },
    { name: 'alaska', code: 'alaska' },
    { name: 'georgia', code: 'georgia' },
    { name: 'indiana', code: 'indiana' },
    { name: 'louisiana', code: 'louisiana' },
    { name: 'massachusetts', code: 'massachusetts' },
    { name: 'minnesota', code: 'minnesota' },
    { name: 'montana', code: 'montana' },
    { name: 'wyoming', code: 'wyoming' },
    { name: 'washington', code: 'washington' },
    { name: 'vermont', code: 'vermont' },
    { name: 'texas', code: 'texas' }
];

const DATA_DIR = './data';
const TEMP_DIR = './temp';

// Конфигурация retry
const RETRY_CONFIG = {
    maxRetries: 5, // Увеличил для проблемных штатов
    initialDelay: 3000, // 3 секунды
    backoffMultiplier: 1.5,
    timeout: 600000 // 10 минут таймаут для больших штатов
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
        let downloadedBytes = 0;
        let totalBytes = 0;
        
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
            timeout: 60000 // 60 секунд на соединение
        }, (response) => {
            if (response.statusCode === 200) {
                totalBytes = parseInt(response.headers['content-length']) || 0;
                
                response.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    if (totalBytes > 0) {
                        const percent = Math.round((downloadedBytes / totalBytes) * 100);
                        process.stdout.write(`\r   Загружено: ${percent}% (${Math.round(downloadedBytes / 1024 / 1024)}MB)`);
                    }
                });
                
                response.pipe(file);
                
                file.on('finish', () => {
                    if (!isResolved) {
                        isResolved = true;
                        file.close();
                        clearTimeout(timeout);
                        console.log(); // Новая строка после прогресса
                        resolve();
                    }
                });
                
                file.on('error', (err) => {
                    if (!isResolved) {
                        isResolved = true;
                        clearTimeout(timeout);
                        fs.unlink(dest, () => {});
                        console.log(); // Новая строка после прогресса
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
                console.log(); // Новая строка после прогресса
                reject(err);
            }
        });

        request.on('timeout', () => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timeout);
                file.destroy();
                fs.unlink(dest, () => {});
                console.log(); // Новая строка после прогресса
                reject(new Error('Request timeout'));
            }
        });
    });
}

async function downloadFile(url, dest, stateName) {
    let lastError;
    
    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
        try {
            console.log(`   Попытка загрузки ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1} для ${stateName}...`);
            await downloadFileWithRetry(url, dest);
            return; // Успешная загрузка
        } catch (error) {
            lastError = error;
            console.warn(`   ❌ Ошибка загрузки (попытка ${attempt + 1}):`, error.message);
            
            if (attempt < RETRY_CONFIG.maxRetries) {
                const delay = RETRY_CONFIG.initialDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt);
                console.log(`   ⏳ Ожидание ${Math.round(delay / 1000)} секунд перед повторной попыткой...`);
                await sleep(delay);
            }
        }
    }
    
    throw new Error(`Не удалось загрузить файл после ${RETRY_CONFIG.maxRetries + 1} попыток. Последняя ошибка: ${lastError.message}`);
}

async function processState(state, index, total) {
    console.log(`\n[${index + 1}/${total}] 🏛️  Обработка штата ${state.name.toUpperCase()}...`);
    
    const pbfFile = path.join(TEMP_DIR, `${state.code}.osm.pbf`);
    const url = `https://download.geofabrik.de/north-america/us/${state.code}-latest.osm.pbf`;
    
    try {
        // Проверяем, не обработан ли уже этот штат
        const existingFiles = fs.readdirSync(DATA_DIR);
        const stateFiles = existingFiles.filter(file => file.startsWith(state.code));
        
        if (stateFiles.length > 0) {
            console.log(`   ✅ ${state.name} уже обработан, пропускаем...`);
            return true;
        }

        // Удаляем старые частичные файлы
        if (fs.existsSync(pbfFile)) {
            fs.unlinkSync(pbfFile);
            console.log(`   🗑️  Удален старый частичный файл`);
        }

        // Загрузка файла с retry логикой
        console.log(`   📥 Загрузка данных для ${state.name}...`);
        await downloadFile(url, pbfFile, state.name);
        console.log(`   ✅ Загрузка ${state.name} завершена успешно`);
        
        // Обработка файла с помощью OSRM
        console.log(`   ⚙️  Извлечение данных для ${state.name}...`);
        execSync(`docker run -t -v "${path.resolve(TEMP_DIR)}:/data" ghcr.io/project-osrm/osrm-backend osrm-extract -p /opt/car.lua /data/${state.code}.osm.pbf`, { stdio: 'inherit' });
        
        console.log(`   🔄 Создание разделов для ${state.name}...`);
        execSync(`docker run -t -v "${path.resolve(TEMP_DIR)}:/data" ghcr.io/project-osrm/osrm-backend osrm-partition /data/${state.code}.osrm`, { stdio: 'inherit' });
        
        console.log(`   🎯 Настройка данных для ${state.name}...`);
        execSync(`docker run -t -v "${path.resolve(TEMP_DIR)}:/data" ghcr.io/project-osrm/osrm-backend osrm-customize /data/${state.code}.osrm`, { stdio: 'inherit' });
        
        // Перемещение обработанных файлов
        const files = fs.readdirSync(TEMP_DIR);
        let movedFiles = 0;
        
        files.forEach(file => {
            if (file.startsWith(state.code)) {
                const srcPath = path.join(TEMP_DIR, file);
                const destPath = path.join(DATA_DIR, file);
                
                try {
                    fs.renameSync(srcPath, destPath);
                    movedFiles++;
                } catch (renameError) {
                    // Если rename не работает, копируем и удаляем
                    fs.copyFileSync(srcPath, destPath);
                    fs.unlinkSync(srcPath);
                    movedFiles++;
                }
            }
        });
        
        console.log(`   ✅ ${state.name} успешно обработан! (${movedFiles} файлов перемещено)`);
        
        // Небольшая пауза между штатами
        await sleep(2000);
        
        return true;
        
    } catch (error) {
        console.error(`   ❌ Ошибка при обработке ${state.name}:`, error.message);
        
        // Очищаем частично загруженные файлы
        try {
            if (fs.existsSync(pbfFile)) {
                fs.unlinkSync(pbfFile);
                console.log(`   🗑️  Очищен поврежденный файл ${pbfFile}`);
            }
        } catch (cleanupError) {
            console.warn(`   ⚠️  Предупреждение: не удалось очистить файл ${pbfFile}`);
        }
        
        return false;
    }
}

async function processSpecificStates() {
    console.log('🚀 Начинаем загрузку и обработку выбранных штатов США...');
    console.log(`⚙️  Настройки retry: максимум ${RETRY_CONFIG.maxRetries} попыток, таймаут ${RETRY_CONFIG.timeout/1000} секунд`);
    console.log(`📋 Штатов к обработке: ${specificStates.length}`);
    console.log('━'.repeat(80));
    
    let processed = 0;
    let failed = 0;
    let skipped = 0;
    const failedStates = [];
    
    for (let i = 0; i < specificStates.length; i++) {
        const state = specificStates[i];
        
        try {
            const result = await processState(state, i, specificStates.length);
            if (result === true) {
                // Проверяем, был ли штат уже обработан
                const existingFiles = fs.readdirSync(DATA_DIR);
                const stateFiles = existingFiles.filter(file => file.startsWith(state.code));
                
                if (stateFiles.length > 0 && result === true) {
                    const wasProcessedBefore = stateFiles.some(file => file.includes('.osrm'));
                    if (wasProcessedBefore) {
                        skipped++;
                    } else {
                        processed++;
                    }
                } else {
                    processed++;
                }
            }
        } catch (error) {
            failed++;
            failedStates.push(state.name);
            console.error(`❌ Окончательная ошибка для ${state.name}:`, error.message);
        }
    }
    
    console.log('\n' + '━'.repeat(80));
    console.log(`📊 ИТОГИ ОБРАБОТКИ:`);
    console.log(`✅ Успешно обработано: ${processed} штатов`);
    console.log(`⏭️  Пропущено (уже обработано): ${skipped} штатов`);
    console.log(`❌ Ошибки: ${failed} штатов`);
    console.log(`📁 Всего штатов: ${specificStates.length}`);
    
    if (failedStates.length > 0) {
        console.log(`\n❌ Неудачные штаты: ${failedStates.join(', ')}`);
        console.log('⚠️  Временные файлы сохранены для повторной обработки');
    } else {
        console.log('\n🎉 Все штаты успешно обработаны!');
        
        // Очистка временной директории только при полном успехе
        try {
            const tempFiles = fs.readdirSync(TEMP_DIR);
            tempFiles.forEach(file => {
                if (tempFiles.includes(file)) {
                    fs.unlinkSync(path.join(TEMP_DIR, file));
                }
            });
            console.log('✅ Временные файлы очищены');
        } catch (cleanupError) {
            console.warn('⚠️  Предупреждение: не удалось очистить временные файлы');
        }
    }
}

// Проверяем аргументы командной строки
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🏛️  Скрипт загрузки выбранных штатов США для OSRM

Использование:
  node download-specific-states.js

Загружаемые штаты:
${specificStates.map(s => `  • ${s.name}`).join('\n')}

Опции:
  --help, -h    Показать эту справку
`);
    process.exit(0);
}

processSpecificStates().catch(console.error); 