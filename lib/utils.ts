import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'

export interface AWSAccount {
    name: string,
    account_id: string
}

export const getFullFilePath = (filePath: string, fileName: string): string => {
    const fullFilePath = path.join(__dirname, filePath) + fileName
    return fullFilePath
}

const getAccountIds = (filePath: string, fileName: string): AWSAccount[] => {
    try {
        const fileContents = fs.readFileSync(getFullFilePath(filePath, fileName), 'utf8')
        const data = yaml.load(fileContents) as AWSAccount[]
        return data
    } catch (e) {
        console.log(e)
        throw new Error('getAccountIds: Cannot read file')
    }
}

export const getAccountId = (accountName: string, filePath: string, fileName: string): string => {
    const accountIds = getAccountIds(filePath, fileName)
    const found = accountIds.find((item) => {
        return item.name === accountName
    })
    if (found == undefined) {
        throw new Error(`getAccountId: cannot get account id from account name ${accountName}`)
    }
    return found.account_id
}

interface EndPoint {
    service: string
}
export const getEndpoints = (filePath: string, fileName: string): string[] => {
    try {
        const fileContents = fs.readFileSync(getFullFilePath(filePath, fileName), 'utf8')
        const data = yaml.load(fileContents) as EndPoint[]
        let services: string[] = []
        data.forEach((item) => {
            services.push(item.service)
        })
        return services
    } catch (e) {
        console.log(e)
        throw new Error('getAccountIds: Cannot read file')
    }

}