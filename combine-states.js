const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const DATA_DIR = './data';

console.log('Объединение данных штатов...');

// Объединяем все .osrm файлы в один
const command = `docker run -t -v "${path.resolve(DATA_DIR)}:/data" ghcr.io/project-osrm/osrm-backend osrm-contract /data/combined.osrm`;

try {
    // Копируем данные первого штата как основу
    execSync(`copy "${DATA_DIR}\\arizona.osrm" "${DATA_DIR}\\combined.osrm"`, { shell: 'cmd.exe' });
    
    // Копируем все дополнительные файлы
    const files = fs.readdirSync(DATA_DIR);
    for (const file of files) {
        if (file.startsWith('arizona.osrm.') && !file.includes('.timestamp')) {
            const newName = file.replace('arizona.osrm.', 'combined.osrm.');
            execSync(`copy "${DATA_DIR}\\${file}" "${DATA_DIR}\\${newName}"`, { shell: 'cmd.exe' });
        }
    }
    
    console.log('Данные успешно объединены!');
    
    // Выполняем контрактинг
    console.log('Выполняем контрактинг данных...');
    execSync(command, { stdio: 'inherit' });
    
    console.log('Готово! Теперь можно запускать сервер.');
} catch (error) {
    console.error('Произошла ошибка:', error);
    process.exit(1);
} 