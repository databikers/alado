@echo off

  :: Copy the file to the destination
copy /Y "accets\swagger-initializer.js" "..\swagger-ui-dist\swagger-initializer.js"

  :: Set full permissions on the file (equivalent to chmod -R 777)
icacls "..\swagger-ui-dist\swagger-initializer.js" /grant Everyone:F

echo Post-installation script completed.