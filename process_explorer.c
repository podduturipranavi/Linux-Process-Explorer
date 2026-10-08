#include <stdio.h>
#include <stdlib.h>
#include <dirent.h>
#include <ctype.h>
#include <string.h>

int is_numeric(const char *name)
{
    if (name == NULL || *name == '\0')
        return 0;

    for (int i = 0; name[i] != '\0'; i++)
    {
        if (!isdigit((unsigned char)name[i]))
            return 0;
    }

    return 1;
}

int main(void)
{
    DIR *dir;
    struct dirent *entry;

    printf("=========================================\n");
    printf("          LINUX PROCESS EXPLORER\n");
    printf("=========================================\n");
    printf("%s %s\n", "PID", "PPID");
    printf("-----------------------------------------\n");
    dir = opendir("/proc");

    if (dir == NULL)
    {
        perror("Unable to open /proc");
        return 1;
    }

    while ((entry = readdir(dir)) != NULL)
    {
         if (is_numeric(entry->d_name))
        {
            char path[512];
            char line[256];

            int pid = 0;
            int ppid = 0;

            FILE *file;


            snprintf(path, sizeof(path),
                     "/proc/%s/status", entry->d_name);


            file = fopen(path, "r");

            if (file == NULL)
                continue;
            while (fgets(line, sizeof(line), file) != NULL)
            {
                if (strncmp(line, "Pid:", 4) == 0)
                {
                    sscanf(line, "Pid:\t%d", &pid);
                }
                else if (strncmp(line, "PPid:", 5) == 0)
                {
                    sscanf(line, "PPid:\t%d", &ppid);
                }

                if (pid != 0 && ppid != 0)
                    break;
            }

            fclose(file);

            printf("%d %d\n", pid, ppid);
        }
    }

     closedir(dir);

    return 0;
}
